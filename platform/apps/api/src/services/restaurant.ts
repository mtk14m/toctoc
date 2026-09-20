import type { PartnerType } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import { utcDay } from '../lib/utc-day.js'
import type { MenuEntry } from './group-order.js'
import {
  explainAvailability,
  formatClock,
  type Availability,
  type ScheduleRules,
} from './schedule.js'

/** Ce que l'annuaire lit d'un partenaire : la présentation et les heures, rien d'interne. */
export interface RestaurantRecord {
  id: string
  name: string
  type: PartnerType
  city: string
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  tags: string[]
  serviceStartMinute: number
  serviceEndMinute: number
}

/** Lecture seule, pour l'annuaire public. Prisma en production, en mémoire dans les tests. */
export interface RestaurantStore {
  listActive(): Promise<RestaurantRecord[]>
  findActive(id: string): Promise<RestaurantRecord | null>
  /** Moyenne et nombre de notes ; un restaurant sans note est absent du résultat. */
  ratingsFor(partnerIds: string[]): Promise<Map<string, { average: number; count: number }>>
  /** Plats actifs disponibles ce jour-là (`date` = minuit UTC), par restaurant. */
  menuOn(partnerIds: string[], date: Date): Promise<Map<string, MenuEntry[]>>
}

const PREVIEW_SIZE = 3

export interface RestaurantServiceDeps {
  store: RestaurantStore
  rules: ScheduleRules
  now?: () => Date
}

export function createRestaurantService(deps: RestaurantServiceDeps) {
  const { store, rules } = deps
  const now = deps.now ?? (() => new Date())

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr')

  function buildCard(
    record: RestaurantRecord,
    rating: { average: number; count: number } | undefined,
    dishes: MenuEntry[],
    at: Date,
  ) {
    const menu = [...dishes].sort(byName)
    const availability: Availability = explainAvailability({
      now: at,
      partnerHours: { startMinute: record.serviceStartMinute, endMinute: record.serviceEndMinute },
      rules,
      menuCount: menu.length,
    })

    const card = {
      id: record.id,
      name: record.name,
      type: record.type,
      city: record.city,
      description: record.description,
      logoUrl: record.logoUrl,
      coverUrl: record.coverUrl,
      tags: record.tags,
      hours: {
        start: formatClock(record.serviceStartMinute),
        end: formatClock(record.serviceEndMinute),
      },
      // Jamais « 0 sur 5 » : sans note, aucune note.
      rating: rating
        ? { average: Math.round(rating.average * 10) / 10, count: rating.count }
        : null,
      todaysMenu: {
        count: menu.length,
        preview: menu.slice(0, PREVIEW_SIZE).map(({ name, price }) => ({ name, price })),
      },
      availability,
    }
    return { card, menu }
  }

  return {
    /**
     * L'annuaire : les restaurants actifs, ceux qu'on peut commander maintenant d'abord, puis les
     * mieux notés, puis l'ordre alphabétique. Public : aucune donnée interne (téléphone, adresse,
     * commission).
     */
    async list() {
      const at = now()
      const records = await store.listActive()
      const ids = records.map((record) => record.id)
      const [ratings, menus] = await Promise.all([
        store.ratingsFor(ids),
        store.menuOn(ids, utcDay(at)),
      ])

      return records
        .map(
          (record) =>
            buildCard(record, ratings.get(record.id), menus.get(record.id) ?? [], at).card,
        )
        .sort(
          (a, b) =>
            Number(b.availability.available) - Number(a.availability.available) ||
            (b.rating?.average ?? -1) - (a.rating?.average ?? -1) ||
            byName(a, b),
        )
    },

    /** La fiche d'un restaurant : la même présentation, plus le menu complet du jour. */
    async get(id: string) {
      const at = now()
      const record = await store.findActive(id)
      if (!record) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Restaurant introuvable')

      const [ratings, menus] = await Promise.all([
        store.ratingsFor([id]),
        store.menuOn([id], utcDay(at)),
      ])
      const { card, menu } = buildCard(record, ratings.get(id), menus.get(id) ?? [], at)
      return { ...card, menu }
    },
  }
}

export type RestaurantService = ReturnType<typeof createRestaurantService>
