import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  MenuItemRecord,
  NewMenuItem,
  NewPartner,
  PartnerListItem,
  PartnerRecord,
  PartnerStore,
} from '../services/partner.js'

const partnerSelect = {
  id: true,
  name: true,
  type: true,
  phone: true,
  address: true,
  city: true,
  commissionRate: true,
  serviceStartMinute: true,
  serviceEndMinute: true,
  active: true,
} as const

export class PrismaPartnerStore implements PartnerStore {
  constructor(private readonly db: PrismaClient) {}

  create({
    commissionRate,
    serviceStartMinute,
    serviceEndMinute,
    ...input
  }: NewPartner): Promise<PartnerRecord> {
    return this.db.partner.create({
      // Sans valeur, le défaut du schéma s'applique ; Prisma refuse un `undefined` explicite.
      data: {
        ...input,
        ...(commissionRate !== undefined && { commissionRate }),
        ...(serviceStartMinute !== undefined && { serviceStartMinute }),
        ...(serviceEndMinute !== undefined && { serviceEndMinute }),
      },
      select: partnerSelect,
    })
  }

  listActive(): Promise<PartnerListItem[]> {
    return this.db.partner.findMany({
      where: { active: true },
      select: { id: true, name: true, type: true, city: true },
      orderBy: { name: 'asc' },
    })
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.partner.count({ where: { id } })) > 0
  }

  createMenuItem({ description, photoUrl, ...input }: NewMenuItem): Promise<MenuItemRecord> {
    return this.db.menuItem.create({
      data: {
        ...input,
        ...(description !== undefined && { description }),
        ...(photoUrl !== undefined && { photoUrl }),
      },
      select: {
        id: true,
        partnerId: true,
        name: true,
        description: true,
        price: true,
        photoUrl: true,
        availableDate: true,
      },
    })
  }
}
