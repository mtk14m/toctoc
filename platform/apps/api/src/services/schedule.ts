import { AppError } from '../lib/errors.js'
import { utcDay } from '../lib/utc-day.js'

/**
 * Les règles de temps d'une commande (docs/06 « Le principe » et « Horaires libres »). Une
 * commande reste ouverte `orderWindowMinutes` à partir du moment où on la commence ; elle est
 * ensuite préparée et livrée, ce que résume l'estimation `deliveryLeadMinutes`. On n'en prend
 * que pendant les heures de service (9h - minuit) : jamais de livraison après minuit.
 *
 * Toutes les heures sont en UTC, qui est l'heure de Conakry toute l'année (pas d'heure d'été).
 */
export interface ScheduleRules {
  /** Première minute où on peut commencer une commande (540 = 9h00). */
  serviceStartMinute: number
  /** Minute avant laquelle la livraison doit avoir lieu (1440 = minuit). */
  serviceEndMinute: number
  /** Durée pendant laquelle le lien accepte des commandes. */
  orderWindowMinutes: number
  /** Préparation et trajet, de la fermeture de la commande à la livraison estimée. */
  deliveryLeadMinutes: number
}

export const DEFAULT_SCHEDULE_RULES: ScheduleRules = {
  serviceStartMinute: 540,
  serviceEndMinute: 1440,
  orderWindowMinutes: 20,
  deliveryLeadMinutes: 45,
}

const MINUTE_MS = 60_000
const pad = (n: number) => String(n).padStart(2, '0')

const minutesOfDay = (date: Date) => date.getUTCHours() * 60 + date.getUTCMinutes()

/** « 09:00 » → 540. `24:00` (minuit) est accepté pour une heure de fin ; le reste doit exister. */
export function parseClock(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

/** 540 → « 09:00 ». */
export function formatClock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export interface PartnerHours {
  startMinute: number
  endMinute: number
}

/**
 * Les deux heures d'une commande commencée à `now` : la fermeture et la livraison estimée. Refuse
 * (422) ce qui ne peut pas être servi : avant l'ouverture, trop tard pour être livré avant minuit,
 * ou un partenaire fermé quand il recevrait la commande — c'est à la fermeture que le récap lui
 * est envoyé, donc c'est là qu'il doit être ouvert.
 */
export function planOrder(input: { now: Date; partnerHours: PartnerHours; rules: ScheduleRules }): {
  orderCutoffTime: Date
  deliveryTime: Date
} {
  const { now, partnerHours, rules } = input

  const orderCutoffTime = new Date(now.getTime() + rules.orderWindowMinutes * MINUTE_MS)
  const deliveryTime = new Date(orderCutoffTime.getTime() + rules.deliveryLeadMinutes * MINUTE_MS)

  if (minutesOfDay(now) < rules.serviceStartMinute) {
    throw new AppError(
      422,
      'SERVICE_NOT_OPEN',
      `Les commandes ouvrent à ${formatClock(rules.serviceStartMinute)}`,
      { opensAt: formatClock(rules.serviceStartMinute) },
    )
  }

  const deliveredSameDay = utcDay(deliveryTime).getTime() === utcDay(now).getTime()
  if (!deliveredSameDay || minutesOfDay(deliveryTime) >= rules.serviceEndMinute) {
    throw new AppError(
      422,
      'TOO_LATE_TO_DELIVER',
      `Trop tard pour être livré avant ${formatClock(rules.serviceEndMinute)}`,
      { closesAt: formatClock(rules.serviceEndMinute) },
    )
  }

  const cutoffMinute = minutesOfDay(orderCutoffTime)
  if (cutoffMinute < partnerHours.startMinute || cutoffMinute >= partnerHours.endMinute) {
    throw new AppError(
      422,
      'PARTNER_CLOSED_AT_THAT_TIME',
      `Ce restaurant prend les commandes de ${formatClock(partnerHours.startMinute)} à ${formatClock(partnerHours.endMinute)}`,
      {
        opensAt: formatClock(partnerHours.startMinute),
        closesAt: formatClock(partnerHours.endMinute),
      },
    )
  }

  return { orderCutoffTime, deliveryTime }
}
