import { randomInt } from 'node:crypto'
import type { DeliveryStatus, GroupOrderStatus } from '../generated/prisma/enums.js'
import { summarizeDishes, type DishLine } from '../lib/dishes.js'
import { AppError } from '../lib/errors.js'
import { safeEqual } from '../lib/safe-equal.js'
import { groupOrderRoom, type RealtimePublisher } from '../realtime/events.js'

/** Un code à 4 chiffres se devine en 10 000 essais, pas en 5 (docs/09). */
export const MAX_CONFIRMATION_ATTEMPTS = 5
const CODE_LENGTH = 4

export function generateConfirmationCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, '0')
}

export interface DriverRecord {
  id: string
  userId: string
  active: boolean
}

/** Tout ce qu'il faut savoir d'une livraison. Le code de confirmation n'y figure jamais. */
export interface DeliveryDetail {
  id: string
  status: DeliveryStatus
  driverId: string | null
  groupOrder: {
    id: string
    deliveryAddress: string
    deliveryTime: Date
    /** Celui qui a commencé la commande : le point de contact sur place. */
    creator: { name: string; phone: string }
    restaurant: { name: string; address: string; phone: string }
    /** Une ligne par part payée : les parts annulées ne sont jamais livrées. */
    items: DishLine[]
  }
}

export interface OpsOrderRecord {
  id: string
  status: GroupOrderStatus
  restaurantName: string
  deliveryAddress: string
  orderCutoffTime: Date
  deliveryTime: Date
  items: DishLine[]
  delivery: {
    id: string
    status: DeliveryStatus
    driver: { id: string; name: string } | null
  } | null
}

// Une variante par issue (et non `status: 'a' | 'b'`) : TypeScript réduit alors le résultat après
// chaque test, et le service n'accède qu'à ce que l'issue porte vraiment.
export type AssignResult =
  | { status: 'assigned'; deliveryId: string }
  | { status: 'reassigned'; deliveryId: string }
  | { status: 'order_not_found' }
  | { status: 'order_not_ready' }
  | { status: 'already_started' }

export type PickUpResult =
  | { status: 'picked_up'; groupOrderId: string; deliveryTime: Date }
  | { status: 'not_found' }
  | { status: 'invalid_state' }

export type AttemptResult =
  | { status: 'counted'; attempts: number; code: string }
  | { status: 'locked' }
  | { status: 'invalid_state' }
  | { status: 'not_found' }

export type OverrideResult =
  | { status: 'overridden'; groupOrderId: string }
  | { status: 'not_found' }
  | { status: 'already_delivered' }

/**
 * Persistance de la livraison. Prisma en production, en mémoire dans les tests. Chaque changement
 * d'état est atomique et prend le verrou de la livraison (ou de la commande), pour que deux appels
 * simultanés ne se marchent pas dessus — surtout le décompte des essais de code.
 */
export interface DeliveryStore {
  findDriverById(id: string): Promise<DriverRecord | null>
  findDriverByUserId(userId: string): Promise<DriverRecord | null>
  /**
   * Assigne (ou réassigne, tant que rien n'a été récupéré) un livreur à une commande fermée, et
   * trace `delivery.driver_assigned` dans le journal d'audit, dans la même transaction.
   */
  assign(input: { groupOrderId: string; driverId: string; actorId: string }): Promise<AssignResult>
  /** Les livraisons à faire : assignées ou en route, celles du jour d'abord. */
  listForDriver(driverId: string): Promise<DeliveryDetail[]>
  /** `null` si elle n'existe pas ou n'est pas à ce livreur. */
  findForDriver(deliveryId: string, driverId: string): Promise<DeliveryDetail | null>
  /** ASSIGNED → PICKED_UP avec son code, et la commande passe IN_DELIVERY. */
  pickUp(input: {
    deliveryId: string
    driverId: string
    code: string
    at: Date
  }): Promise<PickUpResult>
  /**
   * Compte un essai de confirmation et renvoie le code attendu. Le compte est fait sous verrou :
   * au-delà de MAX_CONFIRMATION_ATTEMPTS, `locked`, quel que soit le code donné ensuite.
   */
  registerAttempt(input: { deliveryId: string; driverId: string }): Promise<AttemptResult>
  /** PICKED_UP → DELIVERED, la commande passe DELIVERED. `null` si ce n'est plus possible. */
  complete(input: { deliveryId: string; at: Date }): Promise<{ groupOrderId: string } | null>
  /**
   * Confirmation manuelle par l'équipe : DELIVERED avec `deliveredByOverride`, et **toujours** une
   * entrée `delivery.manual_override` dans le journal d'audit, dans la même transaction.
   */
  override(input: {
    deliveryId: string
    actorId: string
    reason: string
    at: Date
  }): Promise<OverrideResult>
  /** Les commandes de ces statuts, avec leur livraison éventuelle : la vue de l'équipe. */
  listOrders(statuses: GroupOrderStatus[]): Promise<OpsOrderRecord[]>
}

export interface DeliveryServiceDeps {
  store: DeliveryStore
  realtime: RealtimePublisher
  /** Une annonce temps réel qui échoue est journalisée, jamais propagée : la livraison est déjà écrite. */
  onError?: (error: unknown) => void
  generateCode?: () => string
  now?: () => Date
}

const notFound = () => new AppError(404, 'DELIVERY_NOT_FOUND', 'Livraison introuvable')
const invalidState = () =>
  new AppError(409, 'INVALID_DELIVERY_STATE', 'Cette livraison n’est pas dans le bon état')
const tooManyAttempts = () =>
  new AppError(
    429,
    'TOO_MANY_ATTEMPTS',
    'Trop d’essais : contactez l’équipe TocToc pour confirmer la livraison',
  )

export function createDeliveryService(deps: DeliveryServiceDeps) {
  const { store, realtime } = deps
  const now = deps.now ?? (() => new Date())
  const generateCode = deps.generateCode ?? generateConfirmationCode
  const onError = deps.onError ?? (() => undefined)

  async function requireDriver(userId: string): Promise<DriverRecord> {
    const driver = await store.findDriverByUserId(userId)
    if (!driver || !driver.active) throw new AppError(403, 'FORBIDDEN', 'Accès refusé')
    return driver
  }

  /**
   * Ce que voit le livreur. Le contact sur place n'arrive qu'une fois les plats récupérés, et le
   * code de confirmation n'est jamais là : c'est le groupe qui le détient, pas lui.
   */
  function toManifest(detail: DeliveryDetail) {
    const { dishes, total } = summarizeDishes(detail.groupOrder.items)
    return {
      id: detail.id,
      status: detail.status,
      deliveryAddress: detail.groupOrder.deliveryAddress,
      deliveryTime: detail.groupOrder.deliveryTime,
      restaurant: detail.groupOrder.restaurant,
      dishes,
      totalDishes: total,
      contact: detail.status === 'PICKED_UP' ? detail.groupOrder.creator : null,
    }
  }

  /** Best effort : la livraison est écrite, une annonce ratée ne doit pas faire échouer l'appel. */
  function announce(work: () => void) {
    try {
      work()
    } catch (error) {
      onError(error)
    }
  }

  return {
    /** L'équipe choisit le livreur d'une commande fermée. Réassignable jusqu'à la récupération. */
    async assign(actorId: string, groupOrderId: string, driverId: string) {
      const driver = await store.findDriverById(driverId)
      if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Livreur introuvable')
      if (!driver.active) throw new AppError(422, 'DRIVER_INACTIVE', 'Ce livreur est désactivé')

      const result = await store.assign({ groupOrderId, driverId, actorId })
      switch (result.status) {
        case 'order_not_found':
          throw new AppError(404, 'GROUP_ORDER_NOT_FOUND', 'Commande introuvable')
        case 'order_not_ready':
          throw new AppError(
            409,
            'GROUP_ORDER_NOT_READY',
            'Seule une commande fermée peut être livrée',
          )
        case 'already_started':
          throw new AppError(
            409,
            'DELIVERY_ALREADY_STARTED',
            'Les plats ont déjà été récupérés : le livreur ne peut plus changer',
          )
        default:
          return {
            deliveryId: result.deliveryId,
            groupOrderId,
            driverId,
            reassigned: result.status === 'reassigned',
          }
      }
    },

    async listForDriver(userId: string) {
      const driver = await requireDriver(userId)
      return (await store.listForDriver(driver.id)).map(toManifest)
    },

    /**
     * « Récupéré chez le restaurant » : la livraison part, et le code de confirmation est révélé au
     * groupe — jamais avant, pour réduire le temps où il pourrait fuiter (docs/09).
     */
    async pickUp(userId: string, deliveryId: string) {
      const driver = await requireDriver(userId)
      const at = now()
      const code = generateCode()

      const result = await store.pickUp({ deliveryId, driverId: driver.id, code, at })
      if (result.status === 'not_found') throw notFound()
      if (result.status === 'invalid_state') throw invalidState()

      const estimatedMinutes = Math.max(
        0,
        Math.ceil((result.deliveryTime.getTime() - at.getTime()) / 60_000),
      )
      announce(() =>
        realtime.publish(groupOrderRoom(result.groupOrderId), 'groupOrder:in_delivery', {
          confirmationCode: code,
          estimatedMinutes,
        }),
      )

      const detail = await store.findForDriver(deliveryId, driver.id)
      if (!detail) throw notFound()
      return toManifest(detail)
    },

    /**
     * Le livreur saisit le code que le groupe lui donne : la preuve qu'il est bien arrivé. Chaque
     * essai est compté ; au bout de cinq échecs, seule l'équipe peut confirmer.
     */
    async confirm(userId: string, deliveryId: string, code: string) {
      const driver = await requireDriver(userId)
      const at = now()

      const attempt = await store.registerAttempt({ deliveryId, driverId: driver.id })
      if (attempt.status === 'not_found') throw notFound()
      if (attempt.status === 'invalid_state') throw invalidState()
      if (attempt.status === 'locked') throw tooManyAttempts()

      if (!safeEqual(code, attempt.code)) {
        const attemptsLeft = MAX_CONFIRMATION_ATTEMPTS - attempt.attempts
        if (attemptsLeft <= 0) throw tooManyAttempts()
        throw new AppError(401, 'INVALID_CONFIRMATION_CODE', 'Code incorrect', { attemptsLeft })
      }

      const completed = await store.complete({ deliveryId, at })
      if (!completed) throw invalidState()

      announce(() =>
        realtime.publish(groupOrderRoom(completed.groupOrderId), 'groupOrder:delivered', {
          deliveredAt: at.toISOString(),
        }),
      )
      return { status: 'DELIVERED' as const }
    },

    /**
     * La sortie de secours de l'équipe (relais injoignable, code perdu, livreur verrouillé).
     * Toujours tracée avec sa raison : un contournement visible, jamais une habitude silencieuse.
     */
    async override(actorId: string, deliveryId: string, reason: string) {
      const at = now()
      const result = await store.override({ deliveryId, actorId, reason, at })
      if (result.status === 'not_found') throw notFound()
      if (result.status === 'already_delivered') {
        throw new AppError(409, 'DELIVERY_ALREADY_DELIVERED', 'Cette livraison est déjà confirmée')
      }

      announce(() =>
        realtime.publish(groupOrderRoom(result.groupOrderId), 'groupOrder:delivered', {
          deliveredAt: at.toISOString(),
        }),
      )
      return { status: 'DELIVERED' as const, deliveredByOverride: true as const }
    },

    /** Les commandes à traiter, avec leur récap et leur livreur : ce que l'équipe assigne. */
    async listOrders(statuses: GroupOrderStatus[]) {
      const orders = await store.listOrders(statuses)
      return orders.map(({ items, ...order }) => {
        const { dishes, total } = summarizeDishes(items)
        return { ...order, dishes, totalDishes: total }
      })
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
