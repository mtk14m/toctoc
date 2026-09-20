import { describe, expect, it } from 'vitest'
import { formatClockFr } from './time'

describe('formatClockFr — les heures à la française', () => {
  it('écrit « 9h » pour une heure pile, sans zéro devant', () => {
    expect(formatClockFr('09:00')).toBe('9h')
    expect(formatClockFr('12:00')).toBe('12h')
  })

  it('écrit « 11h30 » avec les minutes quand il y en a', () => {
    expect(formatClockFr('11:30')).toBe('11h30')
    expect(formatClockFr('22:05')).toBe('22h05')
  })

  it('lit minuit « 24:00 » comme l’API l’envoie pour la fin de service', () => {
    expect(formatClockFr('24:00')).toBe('minuit')
    expect(formatClockFr('00:00')).toBe('minuit')
  })

  it('renvoie le texte tel quel s’il n’a pas la forme attendue', () => {
    expect(formatClockFr('bientôt')).toBe('bientôt')
  })
})
