import type { PrismaClient } from '../generated/prisma/client.js'
import type { RatableOrderItem, RatingStore, RatingSummary } from '../services/rating.js'
import { ratingSummaryOfOrder } from './rating-summary.js'

const UNIQUE_VIOLATION = 'P2002'

export class PrismaRatingStore implements RatingStore {
  constructor(private readonly db: PrismaClient) {}

  async findOrderItemForRating(orderItemId: string): Promise<RatableOrderItem | null> {
    const item = await this.db.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        id: true,
        status: true,
        user: { select: { phone: true } },
        groupOrder: { select: { id: true, status: true, partnerId: true } },
      },
    })
    if (!item) return null

    const { user, ...rest } = item
    return { ...rest, userPhone: user.phone }
  }

  async create(input: {
    orderItemId: string
    partnerId: string
    score: number
  }): Promise<'created' | 'already_rated'> {
    try {
      await this.db.rating.create({ data: input })
      return 'created'
    } catch (error) {
      // `orderItemId` est unique : deux notes simultanées pour la même part, une seule passe.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'already_rated'
      throw error
    }
  }

  summaryForOrder(groupOrderId: string): Promise<RatingSummary | null> {
    return ratingSummaryOfOrder(this.db, groupOrderId)
  }
}
