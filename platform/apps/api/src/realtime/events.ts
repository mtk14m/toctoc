import type { OrderItemStatus } from '../generated/prisma/enums.js'

/**
 * Le contrat temps réel de l'API : les évènements que le serveur envoie et ceux qu'il accepte.
 * Il vit ici tant qu'il n'y a pas de frontend ; il montera dans `packages/types` (partagé avec
 * `apps/web`, voir docs/07) quand `apps/web` existera.
 */

/** Une ligne de la liste du groupe. Jamais de téléphone ni d'identifiant : la liste est publique. */
export interface Participant {
  name: string
  dish: string
  quantity: number
  pending: boolean
}

export interface ParticipantAnnouncement {
  participant: Participant
  /** Le tarif de livraison que paiera le prochain arrivant : il baisse à chaque palier franchi. */
  nextDeliveryFee: number
}

export type OrderItemUpdateReason = 'PAYMENT_CONFIRMED' | 'PAYMENT_FAILED' | 'PAYMENT_TOO_LATE'

export interface ServerToClientEvents {
  /** Room du lien. Un paiement vient d'être confirmé : la liste du groupe s'allonge. */
  'groupOrder:item_added': (payload: ParticipantAnnouncement) => void
  /** Room du lien, mode HOST_PAYS : quelqu'un a choisi son plat, en attente du règlement du créateur. */
  'groupOrder:item_pending': (payload: ParticipantAnnouncement) => void
  /** Room de la commande : le message privé de la personne qui a commandé, jamais celui du groupe. */
  'orderItem:updated': (payload: {
    orderItemId: string
    status: OrderItemStatus
    reason: OrderItemUpdateReason
  }) => void
}

export type RoomAck =
  | { ok: true }
  | {
      ok: false
      code: 'GROUP_ORDER_NOT_FOUND' | 'BAD_REQUEST' | 'TOO_MANY_ROOMS' | 'INTERNAL_ERROR'
    }

export interface ClientToServerEvents {
  /** Suivre un lien : le jeton du lien public suffit (rejoindre ne demande pas de compte). */
  'groupOrder:join': (payload: { shareToken: string }, ack: (result: RoomAck) => void) => void
  /** Suivre sa propre commande, avec l'id reçu à la création. */
  'orderItem:watch': (payload: { orderItemId: string }, ack: (result: RoomAck) => void) => void
}

/** Les noms de rooms, au même endroit : une par lien (le groupe) et une par commande (la personne). */
export const groupOrderRoom = (groupOrderId: string) => `groupOrder:${groupOrderId}`
export const orderItemRoom = (orderItemId: string) => `orderItem:${orderItemId}`

/**
 * Ce que les services connaissent du temps réel : jamais l'instance Socket.io elle-même
 * (même principe que les `emitToX` isolés de CityMoov). Ne doit jamais lever : une panne du temps
 * réel ne doit pas faire échouer un paiement.
 */
export interface RealtimePublisher {
  publish<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void
}
