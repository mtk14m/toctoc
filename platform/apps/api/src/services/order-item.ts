import type { GroupOrderStatus, OrderItemStatus, PaymentMode } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import { isValidPhone, normalizePhone } from '../lib/phone.js'
import type { RateLimiter } from '../lib/rate-limiter.js'
import { redisKeys } from '../lib/redis-keys.js'
import { utcDay } from '../lib/utc-day.js'
import { groupOrderRoom, type RealtimePublisher } from '../realtime/events.js'
import type { UserStore } from './auth.js'
import type { PaymentService } from './payment.js'
import { deliveryFeeForRank, priceOrderItem, type OrderItemPrice } from './pricing.js'

// Endpoint public : pas de compte, donc la limite protège contre le spam de paiements sur le
// numéro de quelqu'un d'autre et contre la création de comptes en masse.
export const MAX_JOINS_PER_PHONE = 5
// Large exprès : tout un bureau (20 à 30 collègues) rejoint depuis la même box, souvent dans la
// dernière minute avant l'heure limite.
export const MAX_JOINS_PER_IP = 100
export const JOIN_WINDOW_SECONDS = 10 * 60

export interface JoinableGroupOrder {
  id: string
  status: GroupOrderStatus
  orderCutoffTime: Date
  deliveryTime: Date
  paymentMode: PaymentMode
  partner: { id: string; commissionRate: number }
}

export interface JoinableMenuItem {
  id: string
  partnerId: string
  name: string
  price: number
  active: boolean
  availableDate: Date
}

export interface NewOrderItem {
  groupOrderId: string
  userId: string
  menuItemId: string
  quantity: number
  /** Vrai en SPLIT : le paiement (PENDING) est créé dans la même transaction que la commande. */
  createPayment: boolean
}

export type AddOrderItemResult =
  | {
      status: 'created'
      item: { id: string; status: OrderItemStatus }
      price: OrderItemPrice
      /** Le paiement à lancer chez l'opérateur ; absent en HOST_PAYS (le créateur règle tout). */
      paymentId: string | null
    }
  | { status: 'already_joined' }
  | { status: 'closed' }

/** Persistance des commandes d'un lien. Prisma en production, en mémoire dans les tests. */
export interface OrderItemStore {
  findGroupOrderForJoin(shareToken: string): Promise<JoinableGroupOrder | null>
  findMenuItem(id: string): Promise<JoinableMenuItem | null>
  /**
   * Crée la commande de façon atomique par lien : les commandes simultanées sur un même lien sont
   * sérialisées, pour que deux participants n'obtiennent jamais le même rang de livraison
   * (docs/09 §1). `pricer` reçoit le nombre de commandes non annulées déjà sur le lien, lu sous
   * ce verrou, et renvoie les montants à figer sur la ligne.
   *
   * Sous le même verrou : refuse si le lien n'est plus OPEN (clôture concurrente) ou si ce
   * participant a déjà une commande non annulée.
   */
  addOrderItem(
    input: NewOrderItem,
    pricer: (existingActiveOrderItems: number) => OrderItemPrice,
  ): Promise<AddOrderItemResult>
}

export interface JoinInput {
  menuItemId: string
  quantity: number
  phone: string
  name: string
}

export interface OrderItemServiceDeps {
  store: OrderItemStore
  users: UserStore
  payments: PaymentService
  realtime: RealtimePublisher
  rateLimiter: RateLimiter
  defaultCountryCode: string
  now?: () => Date
}

const groupOrderClosed = () =>
  new AppError(409, 'GROUP_ORDER_CLOSED', 'Ce lien n’accepte plus de commandes')

export function createOrderItemService(deps: OrderItemServiceDeps) {
  const { store, users, payments, realtime, rateLimiter, defaultCountryCode } = deps
  const now = deps.now ?? (() => new Date())

  return {
    /**
     * Rejoint un lien : crée la commande en attente de paiement, au prix du plat et au tarif de
     * livraison du rang d'arrivée (figé, jamais recalculé), puis, en SPLIT, lance le paiement
     * mobile money. Le participant n'a pas d'OTP : son compte est créé à partir de son numéro.
     */
    async join(shareToken: string, input: JoinInput, clientIp: string) {
      const phone = normalizePhone(input.phone, defaultCountryCode)
      if (!isValidPhone(phone)) {
        throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
      }

      // Avant tout accès aux données : une requête bloquée ne doit rien créer.
      const [byPhone, byIp] = await Promise.all([
        rateLimiter.hit(redisKeys.joinsByPhone(phone), JOIN_WINDOW_SECONDS),
        rateLimiter.hit(redisKeys.joinsByIp(clientIp), JOIN_WINDOW_SECONDS),
      ])
      if (byPhone > MAX_JOINS_PER_PHONE || byIp > MAX_JOINS_PER_IP) {
        throw new AppError(
          429,
          'RATE_LIMIT_EXCEEDED',
          'Trop de tentatives. Réessayez dans 10 minutes.',
        )
      }

      const order = await store.findGroupOrderForJoin(shareToken)
      if (!order) throw new AppError(404, 'GROUP_ORDER_NOT_FOUND', 'Lien introuvable')

      // Le statut ne passe à CLOSED qu'à la clôture automatique : l'heure limite fait foi.
      if (order.status !== 'OPEN' || now() >= order.orderCutoffTime) throw groupOrderClosed()

      const menuItem = await store.findMenuItem(input.menuItemId)
      const isOnTodaysMenu =
        menuItem?.active &&
        menuItem.partnerId === order.partner.id &&
        menuItem.availableDate.getTime() === utcDay(order.deliveryTime).getTime()
      if (!menuItem || !isOnTodaysMenu) {
        throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Ce plat n’est pas au menu de ce lien')
      }

      const user = await users.findOrCreateByPhone({ phone, name: input.name })
      if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Compte désactivé')

      const result = await store.addOrderItem(
        {
          groupOrderId: order.id,
          userId: user.id,
          menuItemId: menuItem.id,
          quantity: input.quantity,
          createPayment: order.paymentMode === 'SPLIT',
        },
        (existingActiveOrderItems) =>
          priceOrderItem({
            unitPrice: menuItem.price,
            quantity: input.quantity,
            commissionRate: order.partner.commissionRate,
            existingActiveOrderItems,
          }),
      )

      if (result.status === 'closed') throw groupOrderClosed()
      if (result.status === 'already_joined') {
        throw new AppError(409, 'ALREADY_JOINED', 'Vous avez déjà une commande sur ce lien')
      }

      const { item, price, paymentId } = result
      // Après la transaction : un appel réseau ne doit pas tenir le verrou du lien. Si l'opérateur
      // échoue, `start` annule la commande et lève une 502.
      if (paymentId) await payments.start({ paymentId, amount: price.amount, phone })

      // En SPLIT, la personne n'apparaît qu'une fois payée (voir PaymentService). En HOST_PAYS,
      // personne ne paie individuellement : tout le monde est « en attente » ensemble, et ce
      // n'est pas trompeur (docs/06), donc on l'annonce tout de suite.
      if (order.paymentMode === 'HOST_PAYS') {
        realtime.publish(groupOrderRoom(order.id), 'groupOrder:item_pending', {
          participant: {
            name: user.name,
            dish: menuItem.name,
            quantity: input.quantity,
            pending: true,
          },
          nextDeliveryFee: deliveryFeeForRank(price.rank + 1),
        })
      }

      return {
        id: item.id,
        status: item.status,
        dish: menuItem.name,
        quantity: input.quantity,
        unitPrice: price.unitPrice,
        deliveryFee: price.deliveryFee,
        amount: price.amount,
        payment: paymentId ? { status: 'PENDING' as const } : null,
      }
    },
  }
}

export type OrderItemService = ReturnType<typeof createOrderItemService>
