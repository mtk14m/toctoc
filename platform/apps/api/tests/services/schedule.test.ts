import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCHEDULE_RULES,
  explainAvailability,
  formatClock,
  parseClock,
  planOrder,
} from '../../src/services/schedule.js'

const ALL_DAY = { startMinute: 540, endMinute: 1440 }
const at = (time: string, day = '21') => new Date(`2026-09-${day}T${time}:00.000Z`)

const plan = (now: Date, overrides: Partial<Parameters<typeof planOrder>[0]> = {}) =>
  planOrder({ now, partnerHours: ALL_DAY, rules: DEFAULT_SCHEDULE_RULES, ...overrides })

const failureOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error as { code?: string; statusCode?: number }
  }
  return undefined
}

describe('planOrder — le lien reste ouvert 20 minutes, puis la livraison suit', () => {
  it('ferme le lien 20 minutes après le début de la commande', () => {
    expect(plan(at('12:00')).orderCutoffTime).toEqual(at('12:20'))
  })

  it('estime la livraison à l’heure limite plus 45 minutes (préparation et trajet)', () => {
    expect(plan(at('12:00')).deliveryTime).toEqual(at('13:05'))
  })

  it('la fenêtre et le délai de livraison sont réglables', () => {
    const rules = { ...DEFAULT_SCHEDULE_RULES, orderWindowMinutes: 30, deliveryLeadMinutes: 60 }

    expect(plan(at('12:00'), { rules })).toEqual({
      orderCutoffTime: at('12:30'),
      deliveryTime: at('13:30'),
    })
  })
})

describe('planOrder — service de 9h à minuit', () => {
  it('ouvre à 9h00 pile, pas avant (422 SERVICE_NOT_OPEN)', () => {
    expect(failureOf(() => plan(at('09:00')))).toBeUndefined()
    expect(failureOf(() => plan(at('08:59')))).toMatchObject({
      statusCode: 422,
      code: 'SERVICE_NOT_OPEN',
    })
  })

  it('reste fermé la nuit, après minuit', () => {
    expect(failureOf(() => plan(at('00:30', '22')))).toMatchObject({ code: 'SERVICE_NOT_OPEN' })
    expect(failureOf(() => plan(at('03:00', '22')))).toMatchObject({ code: 'SERVICE_NOT_OPEN' })
  })

  it('refuse une commande qui ne pourrait pas être livrée avant minuit (422 TOO_LATE_TO_DELIVER)', () => {
    // 22h54 + 20 min + 45 min = 23h59 : dernière commande possible
    expect(failureOf(() => plan(at('22:54')))).toBeUndefined()
    expect(failureOf(() => plan(at('22:55')))).toMatchObject({
      statusCode: 422,
      code: 'TOO_LATE_TO_DELIVER',
    })
    expect(failureOf(() => plan(at('23:40')))).toMatchObject({ code: 'TOO_LATE_TO_DELIVER' })
  })

  it('les heures de service sont réglables', () => {
    const rules = { ...DEFAULT_SCHEDULE_RULES, serviceStartMinute: 600, serviceEndMinute: 1320 }

    expect(failureOf(() => plan(at('09:30'), { rules }))).toMatchObject({
      code: 'SERVICE_NOT_OPEN',
    })
    // 21h00 + 20 min + 45 min = 22h05 : après la fin de service à 22h00
    expect(failureOf(() => plan(at('21:00'), { rules }))).toMatchObject({
      code: 'TOO_LATE_TO_DELIVER',
    })
    expect(failureOf(() => plan(at('20:00'), { rules }))).toBeUndefined()
    expect(failureOf(() => plan(at('15:00'), { rules }))).toBeUndefined()
  })
})

describe('planOrder — horaires du partenaire (service réduit)', () => {
  const lunchOnly = { startMinute: 660, endMinute: 900 } // 11h00 - 15h00

  it('le partenaire doit être ouvert quand il reçoit la commande, c’est-à-dire à l’heure limite', () => {
    // début 10h40 → limite 11h00 : il ouvre
    expect(failureOf(() => plan(at('10:40'), { partnerHours: lunchOnly }))).toBeUndefined()
    // début 10h39 → limite 10h59 : encore fermé
    expect(failureOf(() => plan(at('10:39'), { partnerHours: lunchOnly }))).toMatchObject({
      statusCode: 422,
      code: 'PARTNER_CLOSED_AT_THAT_TIME',
    })
  })

  it('l’heure de fermeture est exclue', () => {
    // début 14h39 → limite 14h59 : ouvert ; 14h40 → limite 15h00 : fermé
    expect(failureOf(() => plan(at('14:39'), { partnerHours: lunchOnly }))).toBeUndefined()
    expect(failureOf(() => plan(at('14:40'), { partnerHours: lunchOnly }))).toMatchObject({
      code: 'PARTNER_CLOSED_AT_THAT_TIME',
    })
  })

  it('une cuisinière du déjeuner n’est pas proposée le soir', () => {
    expect(failureOf(() => plan(at('19:00'), { partnerHours: lunchOnly }))).toMatchObject({
      code: 'PARTNER_CLOSED_AT_THAT_TIME',
    })
  })
})

describe('explainAvailability — pourquoi on peut, ou non, commander chez ce restaurant maintenant', () => {
  const lunchOnly = { startMinute: 660, endMinute: 900 }
  const explain = (now: Date, overrides: Partial<Parameters<typeof explainAvailability>[0]> = {}) =>
    explainAvailability({
      now,
      partnerHours: ALL_DAY,
      rules: DEFAULT_SCHEDULE_RULES,
      menuCount: 3,
      ...overrides,
    })

  it('est disponible quand tout est réuni', () => {
    expect(explain(at('12:00'))).toEqual({ available: true })
  })

  it.each([
    ['avant l’ouverture du service', at('08:30'), {}, 'SERVICE_NOT_OPEN'],
    ['trop tard pour être livré avant minuit', at('23:00'), {}, 'TOO_LATE_TO_DELIVER'],
    [
      'restaurant fermé à la fermeture du lien',
      at('19:00'),
      { partnerHours: lunchOnly },
      'PARTNER_CLOSED_AT_THAT_TIME',
    ],
    ['aucun plat au menu aujourd’hui', at('12:00'), { menuCount: 0 }, 'NO_MENU_FOR_DATE'],
  ])('indique la raison : %s', (_label, now, overrides, reason) => {
    expect(explain(now, overrides)).toMatchObject({ available: false, reason })
  })

  it('donne les heures utiles à l’affichage (« ouvre à 11:00 »)', () => {
    expect(explain(at('19:00'), { partnerHours: lunchOnly })).toMatchObject({
      details: { opensAt: '11:00', closesAt: '15:00' },
    })
  })

  it('applique les mêmes règles que la création d’une commande : jamais « disponible » pour un refus', () => {
    // planOrder refuse ? alors explainAvailability aussi, sur toute la journée, minute par minute
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const now = new Date(Date.UTC(2026, 8, 21, 0, minute))
      const refused = (() => {
        try {
          planOrder({ now, partnerHours: lunchOnly, rules: DEFAULT_SCHEDULE_RULES })
          return false
        } catch {
          return true
        }
      })()

      expect(explain(now, { partnerHours: lunchOnly }).available).toBe(!refused)
    }
  })
})

describe('parseClock / formatClock', () => {
  it.each([
    ['09:00', 540],
    ['00:00', 0],
    ['23:59', 1439],
    ['24:00', 1440],
    ['11:30', 690],
  ])('%s ↔ %i minutes', (text, minutes) => {
    expect(parseClock(text)).toBe(minutes)
    expect(formatClock(minutes)).toBe(text)
  })

  it.each(['9:00', '24:01', '12:60', 'midi', '', '25:00'])('refuse %j', (text) => {
    expect(parseClock(text)).toBeNull()
  })
})
