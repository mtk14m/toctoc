import { AppError } from '../lib/errors.js'

/** Un paiement encaissé pour une part qui ne sera pas livrée : à rembourser à la main (Phase 1). */
export interface RefundRecord {
  orderItemId: string
  paymentId: string
  groupOrderId: string
  restaurantName: string
  amount: number
  currency: string
  paidAt: Date | null
  /** La référence chez l'opérateur : ce qu'il faut pour retrouver le débit et le rembourser. */
  providerTransactionId: string | null
  participant: { name: string; phone: string }
}

export type RefundMarkResult =
  | { status: 'recorded' }
  | { status: 'not_found' }
  | { status: 'not_refundable' }
  | { status: 'already_refunded' }

/** Persistance des remboursements. Prisma en production, en mémoire dans les tests. */
export interface RefundStore {
  /** Paiements CONFIRMED dont la part est CANCELLED, sans remboursement déjà enregistré. */
  listPending(): Promise<RefundRecord[]>
  /**
   * Enregistre un remboursement fait à la main dans le journal d'audit (`order_item.refunded`),
   * de façon atomique : un seul de deux appels simultanés l'enregistre.
   */
  markRefunded(input: {
    orderItemId: string
    actorId: string
    reference: string
  }): Promise<RefundMarkResult>
}

export function createRefundService(deps: { store: RefundStore }) {
  const { store } = deps

  return {
    /**
     * Ce qu'il reste à rembourser : un débit arrivé après la fermeture est encaissé mais la part est
     * annulée (voir PaymentService). Les plus anciens d'abord : ce sont eux qui attendent depuis le
     * plus longtemps.
     */
    async listPending(): Promise<RefundRecord[]> {
      const refunds = await store.listPending()
      return refunds.sort(
        (a, b) => (a.paidAt?.getTime() ?? Infinity) - (b.paidAt?.getTime() ?? Infinity),
      )
    },

    /** L'équipe a remboursé la personne (mobile money) : on garde la référence de l'opération. */
    async markRefunded(actorId: string, orderItemId: string, reference: string) {
      const result = await store.markRefunded({ orderItemId, actorId, reference })
      switch (result.status) {
        case 'not_found':
          throw new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'Commande introuvable')
        case 'already_refunded':
          throw new AppError(409, 'ALREADY_REFUNDED', 'Cette commande est déjà remboursée')
        case 'not_refundable':
          throw new AppError(
            409,
            'NOT_REFUNDABLE',
            'Rien à rembourser : la part est livrée, ou le paiement n’a pas été encaissé',
          )
        default:
          return { orderItemId, refunded: true as const }
      }
    },
  }
}

export type RefundService = ReturnType<typeof createRefundService>
