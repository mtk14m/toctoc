import type { GroupOrderStatus, OrderItemStatus, PaymentStatus } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import {
  groupOrderRoom,
  orderItemRoom,
  type OrderItemUpdateReason,
  type RealtimePublisher,
} from '../realtime/events.js'
import { deliveryFeeForRank } from './pricing.js'

/** Fenêtre de grâce après l'heure limite pour un paiement déjà lancé (docs/09 §1). */
export const PAYMENT_GRACE_MS = 2 * 60 * 1000
/** La Guinée n'est pas en zone XOF : la devise est figée par paiement (docs/08). */
export const PAYMENT_CURRENCY = 'GNF'

export interface PaymentInitiation {
  /** Notre identifiant de paiement : l'opérateur le renvoie tel quel dans son webhook. */
  reference: string
  amount: number
  currency: string
  phone: string
}

export interface PaymentEvent {
  reference: string
  providerTransactionId: string
  amount: number
  status: 'CONFIRMED' | 'FAILED'
}

export interface WebhookRequest {
  /** Le corps tel que reçu : la signature se calcule sur ces octets, pas sur du JSON re-sérialisé. */
  rawBody: string
  headers: Record<string, string | string[] | undefined>
}

/**
 * L'opérateur de mobile money. Une implémentation par opérateur : le reste de l'application ne
 * connaît que cette interface (le fournisseur réel reste à choisir).
 */
export interface PaymentGateway {
  /** Demande au participant de valider le paiement sur son téléphone (USSD / PIN de l'opérateur). */
  initiate(input: PaymentInitiation): Promise<void>
  /** Vérifie l'authenticité du webhook (signature) et le traduit. Lève une AppError sinon. */
  parseWebhook(request: WebhookRequest): PaymentEvent
}

export interface PaymentRecord {
  id: string
  amount: number
  status: PaymentStatus
  orderItem: {
    id: string
    status: OrderItemStatus
    quantity: number
    participantName: string
    menuItemName: string
    groupOrder: { id: string; status: GroupOrderStatus; orderCutoffTime: Date }
  }
}

/** Persistance des paiements. Prisma en production, en mémoire dans les tests. */
export interface PaymentStore {
  findById(id: string): Promise<PaymentRecord | null>
  /** Commandes non annulées du lien : c'est ce qui détermine le rang du prochain arrivant. */
  countActiveOrderItems(groupOrderId: string): Promise<number>
  /**
   * Encaisse : Payment PENDING → CONFIRMED, et la commande passe de PENDING_PAYMENT à
   * `orderItemStatus` (sans toucher une commande déjà annulée). Atomique : renvoie faux si le
   * paiement n'était plus PENDING, donc un seul de deux appels simultanés l'emporte.
   */
  settle(
    paymentId: string,
    input: {
      providerTransactionId: string
      paidAt: Date
      orderItemStatus: 'CONFIRMED' | 'CANCELLED'
    },
  ): Promise<boolean>
  /** Échec : Payment PENDING → FAILED, commande PENDING_PAYMENT → CANCELLED. Atomique comme `settle`. */
  fail(paymentId: string): Promise<boolean>
}

export type PaymentOutcome = 'confirmed' | 'late' | 'failed' | 'already_processed'

export interface PaymentServiceDeps {
  store: PaymentStore
  gateway: PaymentGateway
  realtime: RealtimePublisher
  /** Une annonce temps réel qui échoue est journalisée, jamais propagée : l'argent est déjà encaissé. */
  onError?: (error: unknown) => void
  now?: () => Date
}

export function createPaymentService(deps: PaymentServiceDeps) {
  const { store, gateway, realtime } = deps
  const now = deps.now ?? (() => new Date())
  const onError = deps.onError ?? (() => undefined)

  /** Prévient la personne, et elle seule (la room de sa commande). */
  const tellPerson = (
    orderItemId: string,
    status: OrderItemStatus,
    reason: OrderItemUpdateReason,
  ) =>
    realtime.publish(orderItemRoom(orderItemId), 'orderItem:updated', {
      orderItemId,
      status,
      reason,
    })

  /** Annonce à tous ceux qui ont ouvert le lien : la liste s'allonge, et le tarif suivant baisse peut-être. */
  async function announceToGroup(payment: PaymentRecord): Promise<void> {
    const { orderItem } = payment
    const active = await store.countActiveOrderItems(orderItem.groupOrder.id)
    realtime.publish(groupOrderRoom(orderItem.groupOrder.id), 'groupOrder:item_added', {
      participant: {
        name: orderItem.participantName,
        dish: orderItem.menuItemName,
        quantity: orderItem.quantity,
        pending: false,
      },
      nextDeliveryFee: deliveryFeeForRank(active + 1),
    })
  }

  /** Best effort : le paiement est réglé, une annonce ratée ne doit pas faire rejouer le webhook. */
  async function bestEffort(work: () => void | Promise<void>): Promise<void> {
    try {
      await work()
    } catch (error) {
      onError(error)
    }
  }

  async function handleEvent(event: PaymentEvent): Promise<PaymentOutcome> {
    const payment = await store.findById(event.reference)
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Paiement introuvable')

    if (event.status === 'CONFIRMED' && event.amount !== payment.amount) {
      throw new AppError(422, 'AMOUNT_MISMATCH', 'Le montant encaissé ne correspond pas')
    }

    // Les opérateurs rejouent leurs webhooks : un paiement déjà réglé ne change plus jamais.
    if (payment.status !== 'PENDING') return 'already_processed'

    if (event.status === 'FAILED') {
      if (!(await store.fail(payment.id))) return 'already_processed'
      await bestEffort(() => tellPerson(payment.orderItem.id, 'CANCELLED', 'PAYMENT_FAILED'))
      return 'failed'
    }

    const paidAt = now()
    const { orderItem } = payment
    // « CONFIRMED » veut dire argent encaissé ET commande toujours dans les temps (docs/08, docs/09).
    // Trop tard : l'argent est bien parti, mais pas de repas — la commande reste hors du récap
    // partenaire et le paiement est à rembourser (à la main en Phase 1).
    const onTime =
      orderItem.status === 'PENDING_PAYMENT' &&
      orderItem.groupOrder.status === 'OPEN' &&
      paidAt.getTime() < orderItem.groupOrder.orderCutoffTime.getTime() + PAYMENT_GRACE_MS

    const applied = await store.settle(payment.id, {
      providerTransactionId: event.providerTransactionId,
      paidAt,
      orderItemStatus: onTime ? 'CONFIRMED' : 'CANCELLED',
    })
    if (!applied) return 'already_processed'

    if (!onTime) {
      await bestEffort(() => tellPerson(orderItem.id, 'CANCELLED', 'PAYMENT_TOO_LATE'))
      return 'late'
    }

    await bestEffort(async () => {
      await announceToGroup(payment)
      tellPerson(orderItem.id, 'CONFIRMED', 'PAYMENT_CONFIRMED')
    })
    return 'confirmed'
  }

  return {
    /**
     * Lance le paiement d'une commande qui vient d'être créée. Si l'opérateur est injoignable, la
     * commande est annulée (et le participant peut simplement recommencer) plutôt que laissée
     * « en attente » d'un paiement qui ne viendra jamais.
     */
    async start(input: { paymentId: string; amount: number; phone: string }): Promise<void> {
      try {
        await gateway.initiate({
          reference: input.paymentId,
          amount: input.amount,
          currency: PAYMENT_CURRENCY,
          phone: input.phone,
        })
      } catch (cause) {
        await store.fail(input.paymentId)
        throw Object.assign(
          new AppError(502, 'PAYMENT_UNAVAILABLE', 'Le paiement n’a pas pu être lancé. Réessayez.'),
          { cause },
        )
      }
    },

    handleEvent,

    /** Point d'entrée du webhook de l'opérateur : authentifie, puis applique l'évènement. */
    handleWebhook(request: WebhookRequest): Promise<PaymentOutcome> {
      return handleEvent(gateway.parseWebhook(request))
    },
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
