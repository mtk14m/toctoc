import type { PartnerType } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import { isValidPhone, normalizePhone } from '../lib/phone.js'

export interface NewPartner {
  name: string
  type: PartnerType
  phone: string
  address: string
  city: string
  /** Sans valeur, la base applique le défaut du schéma (15 %). */
  commissionRate?: number | undefined
}

export interface PartnerRecord {
  id: string
  name: string
  type: PartnerType
  phone: string
  address: string
  city: string
  commissionRate: number
  active: boolean
}

/** Ce qu'un relais voit pour choisir un partenaire : rien d'interne. */
export interface PartnerListItem {
  id: string
  name: string
  type: PartnerType
  city: string
}

export interface NewMenuItem {
  partnerId: string
  name: string
  description?: string | undefined
  /** En GNF entiers. */
  price: number
  photoUrl?: string | undefined
  /** Minuit UTC du jour où le plat est proposé. */
  availableDate: Date
}

export interface MenuItemRecord {
  id: string
  partnerId: string
  name: string
  description: string | null
  price: number
  photoUrl: string | null
  availableDate: Date
}

/** Persistance des partenaires et de leur menu. Prisma en production, en mémoire dans les tests. */
export interface PartnerStore {
  create(input: NewPartner): Promise<PartnerRecord>
  listActive(): Promise<PartnerListItem[]>
  exists(id: string): Promise<boolean>
  createMenuItem(input: NewMenuItem): Promise<MenuItemRecord>
}

export interface PartnerServiceDeps {
  store: PartnerStore
  defaultCountryCode: string
}

export function createPartnerService(deps: PartnerServiceDeps) {
  const { store, defaultCountryCode } = deps

  return {
    async createPartner(input: NewPartner): Promise<PartnerRecord> {
      const phone = normalizePhone(input.phone, defaultCountryCode)
      if (!isValidPhone(phone)) {
        throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
      }
      return store.create({ ...input, phone })
    },

    listActivePartners(): Promise<PartnerListItem[]> {
      return store.listActive()
    },

    async addMenuItem(partnerId: string, input: Omit<NewMenuItem, 'partnerId'>) {
      if (!(await store.exists(partnerId))) {
        throw new AppError(404, 'PARTNER_NOT_FOUND', 'Partenaire introuvable')
      }

      const item = await store.createMenuItem({ ...input, partnerId })
      // Le jour seul (AAAA-MM-JJ) : c'est ce que le frontend affiche, pas une heure.
      return { ...item, availableDate: item.availableDate.toISOString().slice(0, 10) }
    },
  }
}

export type PartnerService = ReturnType<typeof createPartnerService>
