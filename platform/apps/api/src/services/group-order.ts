import { randomBytes } from 'node:crypto'
import type {
  DeliveryStatus,
  GroupOrderStatus,
  OrderItemStatus,
  PartnerType,
  PaymentMode,
} from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import { isValidPhone, normalizePhone } from '../lib/phone.js'
import type { RateLimiter } from '../lib/rate-limiter.js'
import { redisKeys } from '../lib/redis-keys.js'
import { roundAverage } from '../lib/round-average.js'
import { utcDay } from '../lib/utc-day.js'
import type { Participant } from '../realtime/events.js'
import type { UserStore } from './auth.js'
import { deliveryFeeForRank } from './pricing.js'
import { planOrder, type ScheduleRules } from './schedule.js'

export const MAX_GROUP_ORDER_CREATIONS = 10
// Par IP, large exprès : un bureau entier derrière la même box lance ses commandes, souvent à la
// même heure. Sert surtout à empêcher la création de comptes en masse sans compte ni OTP.
export const MAX_GROUP_ORDER_CREATIONS_PER_IP = 60
export const GROUP_ORDER_CREATION_WINDOW_SECONDS = 60 * 60

export interface PartnerSummary {
  id: string
  name: string
  type: PartnerType
  active: boolean
  /** Heures de service, en minutes depuis minuit (voir `Partner` dans le schéma). */
  serviceStartMinute: number
  serviceEndMinute: number
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
  /** L'état de la livraison, s'il y en a une. */
  delivery: { status: DeliveryStatus; confirmationCode: string | null } | null
  /** La moyenne des notes données à cette commande ; `null` tant que personne n'a noté. */
  rating: { average: number; count: number } | null
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

/** Ce que la personne choisit : le restaurant et l'adresse. Les heures sont calculées (voir schedule.ts). */
export interface CreateGroupOrderInput {
  partnerId: string
  deliveryAddress: string
  deliveryLat?: number | undefined
  deliveryLng?: number | undefined
  paymentMode?: PaymentMode | undefined
}

/**
 * Qui commence la commande : quelqu'un de connecté (jeton), ou n'importe qui avec son téléphone et
 * son nom, comme pour rejoindre — le compte est alors créé discrètement, sans OTP (docs/06).
 */
export type OrderCreator = { userId: string } | { phone: string; name: string; clientIp: string }

/** 12 octets aléatoires → 16 caractères sûrs dans une URL. Le lien ne révèle aucun id interne. */
export function generateShareToken(): string {
  return randomBytes(12).toString('base64url')
}

export interface GroupOrderServiceDeps {
  store: GroupOrderStore
  users: UserStore
  rateLimiter: RateLimiter
  defaultCountryCode: string
  rules: ScheduleRules
  /** Le mode « j'invite tout le monde » reste refusé tant que la charge unique du créateur n'existe pas. */
  hostPaysEnabled?: boolean
  now?: () => Date
  generateShareToken?: () => string
}

export function createGroupOrderService(deps: GroupOrderServiceDeps) {
  const { store, users, rateLimiter, defaultCountryCode, rules } = deps
  const now = deps.now ?? (() => new Date())
  const newShareToken = deps.generateShareToken ?? generateShareToken
  const hostPaysEnabled = deps.hostPaysEnabled ?? false

  const tooManyOrders = () =>
    new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Trop de commandes lancées. Réessayez plus tard.')

  /** Retrouve, ou crée, le compte de celui qui commence la commande. */
  async function resolveCreator(creator: OrderCreator): Promise<{ id: string }> {
    if ('userId' in creator) {
      // Un jeton reste valide jusqu'à son expiration : on revérifie que le compte est toujours actif.
      const user = await users.findById(creator.userId)
      if (!user || !user.isActive) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise')
      }
      return user
    }

    const phone = normalizePhone(creator.phone, defaultCountryCode)
    if (!isValidPhone(phone)) {
      throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
    }
    // Avant de créer le moindre compte : sans compte ni OTP, c'est la seule barrière contre le spam.
    const fromThisIp = await rateLimiter.hit(
      redisKeys.groupOrderCreationsByIp(creator.clientIp),
      GROUP_ORDER_CREATION_WINDOW_SECONDS,
    )
    if (fromThisIp > MAX_GROUP_ORDER_CREATIONS_PER_IP) throw tooManyOrders()

    const user = await users.findOrCreateByPhone({ phone, name: creator.name })
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Compte désactivé')
    return user
  }

  return {
    /**
     * Commence une commande chez un restaurant. Elle reste ouverte 20 minutes, puis elle est
     * préparée et livrée : la personne ne choisit aucune heure. Le partage (`toctoc.app/g/{jeton}`)
     * est l'affaire du frontend ; commander seul, c'est ne pas le partager.
     */
    async create(creator: OrderCreator, input: CreateGroupOrderInput) {
      const paymentMode = input.paymentMode ?? 'SPLIT'
      if (paymentMode === 'HOST_PAYS' && !hostPaysEnabled) {
        throw new AppError(
          422,
          'PAYMENT_MODE_UNAVAILABLE',
          'Le règlement pour tout le groupe n’est pas encore disponible',
        )
      }

      const creatorUser = await resolveCreator(creator)

      const creations = await rateLimiter.hit(
        redisKeys.groupOrderCreations(creatorUser.id),
        GROUP_ORDER_CREATION_WINDOW_SECONDS,
      )
      if (creations > MAX_GROUP_ORDER_CREATIONS) throw tooManyOrders()

      const partner = await store.findPartner(input.partnerId)
      if (!partner || !partner.active) {
        throw new AppError(404, 'PARTNER_NOT_FOUND', 'Restaurant introuvable')
      }

      const { orderCutoffTime, deliveryTime } = planOrder({
        now: now(),
        partnerHours: {
          startMinute: partner.serviceStartMinute,
          endMinute: partner.serviceEndMinute,
        },
        rules,
      })

      // Sans plat au menu ce jour-là, il n'y a rien à commander : on ne fait pas ouvrir une commande vide.
      if ((await store.listMenu(partner.id, utcDay(deliveryTime))).length === 0) {
        throw new AppError(422, 'NO_MENU_FOR_DATE', 'Ce restaurant n’a pas de menu aujourd’hui')
      }

      const shareToken = newShareToken()
      const { id, status } = await store.create({
        creatorId: creatorUser.id,
        partnerId: partner.id,
        shareToken,
        deliveryAddress: input.deliveryAddress,
        deliveryLat: input.deliveryLat,
        deliveryLng: input.deliveryLng,
        orderCutoffTime,
        deliveryTime,
        paymentMode,
      })

      return {
        id,
        shareToken,
        status,
        deliveryAddress: input.deliveryAddress,
        orderCutoffTime,
        deliveryTime,
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
        // Le code de confirmation est la preuve de livraison : il n'existe sur la page que pendant
        // que le livreur est en route (docs/09). Avant, il pourrait fuiter ; après, il ne sert plus.
        delivery: order.delivery && {
          status: order.delivery.status,
          confirmationCode:
            order.delivery.status === 'PICKED_UP' ? order.delivery.confirmationCode : null,
        },
        rating: order.rating && {
          average: roundAverage(order.rating.average),
          count: order.rating.count,
        },
        menu,
        participants: visible.map((item): Participant => ({
          name: item.participantName,
          dish: item.menuItemName,
          quantity: item.quantity,
          pending: item.status === 'PENDING_PAYMENT',
        })),
        // Le rang d'un arrivant compte les commandes en cours, payées ou non (voir `join`) : c'est le
        // tarif que verra le prochain participant, celui qui baisse à chaque palier (waouh n°2).
        nextDeliveryFee: deliveryFeeForRank(
          items.filter((item) => item.status !== 'CANCELLED').length + 1,
        ),
      }
    },
  }
}

export type GroupOrderService = ReturnType<typeof createGroupOrderService>
