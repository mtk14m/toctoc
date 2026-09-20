import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  MenuItemRecord,
  NewMenuItem,
  NewPartner,
  PartnerPatch,
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
  description: true,
  logoUrl: true,
  coverUrl: true,
  tags: true,
  active: true,
} as const

export class PrismaPartnerStore implements PartnerStore {
  constructor(private readonly db: PrismaClient) {}

  create({
    commissionRate,
    serviceStartMinute,
    serviceEndMinute,
    description,
    logoUrl,
    coverUrl,
    tags,
    ...input
  }: NewPartner): Promise<PartnerRecord> {
    return this.db.partner.create({
      // Sans valeur, le défaut du schéma s'applique ; Prisma refuse un `undefined` explicite.
      data: {
        ...input,
        ...(commissionRate !== undefined && { commissionRate }),
        ...(serviceStartMinute !== undefined && { serviceStartMinute }),
        ...(serviceEndMinute !== undefined && { serviceEndMinute }),
        ...(description !== undefined && { description }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(coverUrl !== undefined && { coverUrl }),
        ...(tags !== undefined && { tags }),
      },
      select: partnerSelect,
    })
  }

  findById(id: string): Promise<PartnerRecord | null> {
    return this.db.partner.findUnique({ where: { id }, select: partnerSelect })
  }

  async update(id: string, patch: PartnerPatch): Promise<PartnerRecord | null> {
    try {
      return await this.db.partner.update({
        where: { id },
        // Une clé absente ne change rien (Prisma refuse un `undefined` explicite) ; `null` efface.
        data: {
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl }),
          ...(patch.coverUrl !== undefined && { coverUrl: patch.coverUrl }),
          ...(patch.tags !== undefined && { tags: patch.tags }),
          ...(patch.serviceStartMinute !== undefined && {
            serviceStartMinute: patch.serviceStartMinute,
          }),
          ...(patch.serviceEndMinute !== undefined && { serviceEndMinute: patch.serviceEndMinute }),
          ...(patch.active !== undefined && { active: patch.active }),
        },
        select: partnerSelect,
      })
    } catch (error) {
      // P2025 : le restaurant n'existe pas (ou plus).
      if ((error as { code?: string }).code === 'P2025') return null
      throw error
    }
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
