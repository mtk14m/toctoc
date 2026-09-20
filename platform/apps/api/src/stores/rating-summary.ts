import type { PrismaClient } from '../generated/prisma/client.js'
import type { RatingSummary } from '../services/rating.js'

/** La moyenne des notes données aux parts d'une commande ; `null` si personne n'a noté. */
export async function ratingSummaryOfOrder(
  db: Pick<PrismaClient, 'rating'>,
  groupOrderId: string,
): Promise<RatingSummary | null> {
  const { _avg, _count } = await db.rating.aggregate({
    where: { orderItem: { groupOrderId } },
    _avg: { score: true },
    _count: { _all: true },
  })
  return _avg.score === null ? null : { average: _avg.score, count: _count._all }
}
