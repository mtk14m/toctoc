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
  /** Heures de service en minutes depuis minuit ; sans valeur, 9h - minuit (défaut du schéma). */
  serviceStartMinute?: number | undefined
  serviceEndMinute?: number | undefined
  /** Présentation dans l'annuaire public. */
  description?: string | undefined
  logoUrl?: string | undefined
  coverUrl?: string | undefined
  tags?: string[] | undefined
}

export interface PartnerRecord {
  id: string
  name: string
  type: PartnerType
  phone: string
  address: string
  city: string
  commissionRate: number
  serviceStartMinute: number
  serviceEndMinute: number
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  tags: string[]
  active: boolean
}

/** Ce que l'équipe peut modifier. Une clé absente ne change rien ; `null` efface. */
export interface PartnerPatch {
  description?: string | null | undefined
  logoUrl?: string | null | undefined
  coverUrl?: string | null | undefined
  tags?: string[] | undefined
  serviceStartMinute?: number | undefined
  serviceEndMinute?: number | undefined
  active?: boolean | undefined
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
  findById(id: string): Promise<PartnerRecord | null>
  /** Renvoie null si le restaurant n'existe pas. */
  update(id: string, patch: PartnerPatch): Promise<PartnerRecord | null>
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

    /**
     * Modifie la présentation, les heures ou l'activité d'un restaurant. Les heures sont contrôlées
     * avec celles déjà enregistrées : ne changer que le début ne doit pas le passer après la fin.
     */
    async updatePartner(id: string, patch: PartnerPatch): Promise<PartnerRecord> {
      const current = await store.findById(id)
      if (!current) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Restaurant introuvable')

      const start = patch.serviceStartMinute ?? current.serviceStartMinute
      const end = patch.serviceEndMinute ?? current.serviceEndMinute
      if (start >= end) {
        throw new AppError(
          422,
          'INVALID_SERVICE_HOURS',
          'Le début de service doit être avant la fin de service',
        )
      }

      const updated = await store.update(id, patch)
      if (!updated) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Restaurant introuvable')
      return updated
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
