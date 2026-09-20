/** Ce que l'API renvoie, tel que le contrat le définit (apps/api/src/services/restaurant.ts). */

export type PartnerType = 'RESTAURANT' | 'CUISINE_MAISON'

export type UnavailableReason =
  'SERVICE_NOT_OPEN' | 'TOO_LATE_TO_DELIVER' | 'PARTNER_CLOSED_AT_THAT_TIME' | 'NO_MENU_FOR_DATE'

export type Availability = { available: true } | { available: false; reason: UnavailableReason }

export interface RestaurantCard {
  id: string
  name: string
  type: PartnerType
  city: string
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  tags: string[]
  hours: { start: string; end: string }
  /** `null` tant que personne n'a noté : jamais « 0 sur 5 ». */
  rating: { average: number; count: number } | null
  todaysMenu: { count: number; preview: Array<{ name: string; price: number }> }
  availability: Availability
}
