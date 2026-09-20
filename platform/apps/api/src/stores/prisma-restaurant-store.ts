import type { PrismaClient } from '../generated/prisma/client.js'
import type { MenuEntry } from '../services/group-order.js'
import type { RestaurantRecord, RestaurantStore } from '../services/restaurant.js'

const select = {
  id: true,
  name: true,
  type: true,
  city: true,
  description: true,
  logoUrl: true,
  coverUrl: true,
  tags: true,
  serviceStartMinute: true,
  serviceEndMinute: true,
} as const

export class PrismaRestaurantStore implements RestaurantStore {
  constructor(private readonly db: PrismaClient) {}

  listActive(): Promise<RestaurantRecord[]> {
    return this.db.partner.findMany({ where: { active: true }, select })
  }

  findActive(id: string): Promise<RestaurantRecord | null> {
    return this.db.partner.findFirst({ where: { id, active: true }, select })
  }

  async ratingsFor(partnerIds: string[]): Promise<Map<string, { average: number; count: number }>> {
    const rows = await this.db.rating.groupBy({
      by: ['partnerId'],
      where: { partnerId: { in: partnerIds } },
      _avg: { score: true },
      _count: { _all: true },
    })

    return new Map(
      rows.flatMap((row) =>
        row._avg.score === null
          ? []
          : [[row.partnerId, { average: row._avg.score, count: row._count._all }] as const],
      ),
    )
  }

  async menuOn(partnerIds: string[], date: Date): Promise<Map<string, MenuEntry[]>> {
    const items = await this.db.menuItem.findMany({
      where: { partnerId: { in: partnerIds }, availableDate: date, active: true },
      select: {
        partnerId: true,
        id: true,
        name: true,
        description: true,
        price: true,
        photoUrl: true,
      },
    })

    const byPartner = new Map<string, MenuEntry[]>()
    for (const { partnerId, ...dish } of items) {
      byPartner.set(partnerId, [...(byPartner.get(partnerId) ?? []), dish])
    }
    return byPartner
  }
}
