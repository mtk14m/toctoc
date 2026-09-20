import type { GroupOrderStatus, OrderItemStatus } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import { roundAverage } from '../lib/round-average.js'
import { normalizePhone, isValidPhone } from '../lib/phone.js'
import type { RateLimiter } from '../lib/rate-limiter.js'
import { redisKeys } from '../lib/redis-keys.js'
import { groupOrderRoom, type RealtimePublisher } from '../realtime/events.js'

// Large exprès : tout un bureau note depuis la même box, dans les minutes qui suivent la livraison.
export const MAX_RATINGS_PER_IP = 60
export const RATING_WINDOW_SECONDS = 10 * 60

export interface RatingSummary {
  average: number
  count: number
}

export interface RatableOrderItem {
  id: string
  status: OrderItemStatus
  /** Le numéro de celui qui a commandé : c'est ce qui prouve que la part est la sienne. */
  userPhone: string
  groupOrder: { id: string; status: GroupOrderStatus; partnerId: string }
}

/** Persistance des notes. Prisma en production, en mémoire dans les tests. */
export interface RatingStore {
  findOrderItemForRating(orderItemId: string): Promise<RatableOrderItem | null>
  /** `already_rated` si cette part a déjà sa note (contrainte d'unicité de la base). */
  create(input: {
    orderItemId: string
    partnerId: string
    score: number
  }): Promise<'created' | 'already_rated'>
  /** La moyenne et le nombre de notes de cette commande ; `null` si personne n'a noté. */
  summaryForOrder(groupOrderId: string): Promise<RatingSummary | null>
}

export interface RatingServiceDeps {
  store: RatingStore
  realtime: RealtimePublisher
  rateLimiter: RateLimiter
  defaultCountryCode: string
}

const notFound = () => new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'Commande introuvable')

export function createRatingService(deps: RatingServiceDeps) {
  const { store, realtime, rateLimiter, defaultCountryCode } = deps

  return {
    /**
     * Note le restaurant, une fois la commande livrée (docs/09 §4). Pas de compte : le numéro de la
     * part suffit, comme pour rejoindre. Un numéro qui ne correspond pas répond exactement comme
     * une part inconnue, pour qu'on ne puisse pas sonder les parts des autres.
     */
    async rate(orderItemId: string, input: { phone: string; score: number }, clientIp: string) {
      const phone = normalizePhone(input.phone, defaultCountryCode)
      if (!isValidPhone(phone)) {
        throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
      }

      const hits = await rateLimiter.hit(redisKeys.ratingsByIp(clientIp), RATING_WINDOW_SECONDS)
      if (hits > MAX_RATINGS_PER_IP) {
        throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Trop de notes. Réessayez plus tard.')
      }

      const item = await store.findOrderItemForRating(orderItemId)
      if (!item || normalizePhone(item.userPhone, defaultCountryCode) !== phone) throw notFound()

      // On ne note que ce qu'on a payé, puis reçu.
      if (item.status !== 'CONFIRMED') {
        throw new AppError(409, 'NOT_RATEABLE', 'Seule une part payée peut être notée')
      }
      if (item.groupOrder.status !== 'DELIVERED') {
        throw new AppError(409, 'NOT_DELIVERED_YET', 'La commande n’est pas encore livrée')
      }

      const created = await store.create({
        orderItemId,
        partnerId: item.groupOrder.partnerId,
        score: input.score,
      })
      if (created === 'already_rated') {
        throw new AppError(409, 'ALREADY_RATED', 'Vous avez déjà noté cette commande')
      }

      const summary = await store.summaryForOrder(item.groupOrder.id)
      if (!summary) throw new Error('Une note vient d’être créée : le résumé ne peut pas être vide')
      const rounded = { average: roundAverage(summary.average), count: summary.count }

      // La note est écrite : une annonce ratée ne doit pas la faire échouer.
      try {
        realtime.publish(groupOrderRoom(item.groupOrder.id), 'groupOrder:rating_added', rounded)
      } catch {
        /* le publisher ne lève jamais ; garde-fou */
      }
      return { score: input.score, summary: rounded }
    },
  }
}

export type RatingService = ReturnType<typeof createRatingService>
