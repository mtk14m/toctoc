import { randomBytes } from 'node:crypto'
import type {
  GroupOrderStatus,
  OrderItemStatus,
  PartnerType,
  PaymentMode,
} from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import type { RateLimiter } from '../lib/rate-limiter.js'
import { redisKeys } from '../lib/redis-keys.js'
import type { UserStore } from './auth.js'

export const MAX_GROUP_ORDER_CREATIONS = 10
export const GROUP_ORDER_CREATION_WINDOW_SECONDS = 60 * 60

export interface PartnerSummary {
  id: string
  name: string
  type: PartnerType
  active: boolean
}

export interface NewGroupOrder {
  creatorId: string
  partnerId: string
  shareToken: string
  deliveryAddress: string
  deliveryLat?: number | undefined
  deliveryLng?: number | undefined
  orderCutoffTime: Date
  deliveryTime: Date
  paymentMode: PaymentMode
}

export interface GroupOrderRecord {
  id: string
  status: GroupOrderStatus
  deliveryAddress: string
  orderCutoffTime: Date
  deliveryTime: Date
  paymentMode: PaymentMode
  creatorName: string
  partner: { id: string; name: string; type: PartnerType }
}

export interface MenuEntry {
  id: string
  name: string
  description: string | null
  price: number
  photoUrl: string | null
}

export interface OrderItemEntry {
  id: string
  participantName: string
  menuItemName: string
  quantity: number
  status: OrderItemStatus
}

/** Persistance des liens de commande groupée. Prisma en production, en mémoire dans les tests. */
export interface GroupOrderStore {
  findPartner(id: string): Promise<PartnerSummary | null>
  create(input: NewGroupOrder): Promise<{ id: string; status: GroupOrderStatus }>
  findByShareToken(shareToken: string): Promise<GroupOrderRecord | null>
  /** Plats actifs de ce partenaire, disponibles ce jour-là (`date` = minuit UTC). */
  listMenu(partnerId: string, date: Date): Promise<MenuEntry[]>
  listOrderItems(groupOrderId: string): Promise<OrderItemEntry[]>
}

export interface CreateGroupOrderInput {
  partnerId: string
  deliveryAddress: string
  deliveryLat?: number | undefined
  deliveryLng?: number | undefined
  orderCutoffTime: Date
  deliveryTime: Date
  paymentMode?: PaymentMode | undefined
}

/** 12 octets aléatoires → 16 caractères sûrs dans une URL. Le lien ne révèle aucun id interne. */
export function generateShareToken(): string {
  return randomBytes(12).toString('base64url')
}

/** Minuit UTC du jour de `date`. La Guinée est en UTC toute l'année : pas de décalage à gérer. */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export interface GroupOrderServiceDeps {
  store: GroupOrderStore
  users: UserStore
  rateLimiter: RateLimiter
  now?: () => Date
  generateShareToken?: () => string
}

export function createGroupOrderService(deps: GroupOrderServiceDeps) {
  const { store, users, rateLimiter } = deps
  const now = deps.now ?? (() => new Date())
  const newShareToken = deps.generateShareToken ?? generateShareToken

  return {
    /** Crée un lien ouvert. Le partage (`toctoc.app/g/{shareToken}`) est l'affaire du frontend. */
    async create(creatorId: string, input: CreateGroupOrderInput) {
      // Un jeton reste valide jusqu'à son expiration : on revérifie que le compte est toujours actif.
      const creator = await users.findById(creatorId)
      if (!creator || !creator.isActive) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise')
      }

      const creations = await rateLimiter.hit(
        redisKeys.groupOrderCreations(creatorId),
        GROUP_ORDER_CREATION_WINDOW_SECONDS,
      )
      if (creations > MAX_GROUP_ORDER_CREATIONS) {
        throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Trop de liens créés. Réessayez plus tard.')
      }

      if (input.orderCutoffTime <= now()) {
        throw new AppError(422, 'CUTOFF_IN_PAST', 'L’heure limite de commande est déjà passée')
      }
      if (input.deliveryTime <= input.orderCutoffTime) {
        throw new AppError(
          422,
          'DELIVERY_BEFORE_CUTOFF',
          'La livraison doit avoir lieu après l’heure limite de commande',
        )
      }

      const partner = await store.findPartner(input.partnerId)
      if (!partner || !partner.active) {
        throw new AppError(404, 'PARTNER_NOT_FOUND', 'Partenaire introuvable')
      }

      const paymentMode = input.paymentMode ?? 'SPLIT'
      const shareToken = newShareToken()
      const { id, status } = await store.create({
        creatorId,
        partnerId: partner.id,
        shareToken,
        deliveryAddress: input.deliveryAddress,
        deliveryLat: input.deliveryLat,
        deliveryLng: input.deliveryLng,
        orderCutoffTime: input.orderCutoffTime,
        deliveryTime: input.deliveryTime,
        paymentMode,
      })

      return {
        id,
        shareToken,
        status,
        deliveryAddress: input.deliveryAddress,
        orderCutoffTime: input.orderCutoffTime,
        deliveryTime: input.deliveryTime,
        paymentMode,
      }
    },

    /**
     * Ce que voit quelqu'un qui ouvre le lien (public, sans compte) : le menu du jour et la liste
     * des participants. Aucun numéro de téléphone, aucun identifiant interne.
     */
    async getByShareToken(shareToken: string) {
      const order = await store.findByShareToken(shareToken)
      if (!order) throw new AppError(404, 'GROUP_ORDER_NOT_FOUND', 'Lien introuvable')

      const [menu, items] = await Promise.all([
        store.listMenu(order.partner.id, utcDay(order.deliveryTime)),
        store.listOrderItems(order.id),
      ])

      // SPLIT : seules les commandes payées comptent, jamais de ligne « en attente » qui laisserait
      // croire au groupe que quelqu'un est dedans. HOST_PAYS : tout le monde attend le règlement
      // du créateur, on montre donc les commandes en attente, explicitement marquées.
      const visible = items.filter((item) =>
        order.paymentMode === 'HOST_PAYS'
          ? item.status !== 'CANCELLED'
          : item.status === 'CONFIRMED',
      )

      return {
        status: order.status,
        deliveryAddress: order.deliveryAddress,
        orderCutoffTime: order.orderCutoffTime,
        deliveryTime: order.deliveryTime,
        paymentMode: order.paymentMode,
        creatorName: order.creatorName,
        partner: { name: order.partner.name, type: order.partner.type },
        menu,
        participants: visible.map((item) => ({
          name: item.participantName,
          dish: item.menuItemName,
          quantity: item.quantity,
          pending: item.status === 'PENDING_PAYMENT',
        })),
      }
    },
  }
}

export type GroupOrderService = ReturnType<typeof createGroupOrderService>
