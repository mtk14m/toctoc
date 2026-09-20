import { describe, expect, it } from 'vitest'
import { formatGnf } from './money'

describe('formatGnf — les francs guinéens', () => {
  it('sépare les milliers par une espace insécable et ajoute la devise', () => {
    expect(formatGnf(31000)).toBe('31\u202F000\u00A0GNF')
    expect(formatGnf(6000)).toBe('6\u202F000\u00A0GNF')
    expect(formatGnf(1250000)).toBe('1\u202F250\u202F000\u00A0GNF')
  })

  it('n’affiche jamais de décimales : le franc guinéen n’a pas de centimes', () => {
    expect(formatGnf(3000)).toBe('3\u202F000\u00A0GNF')
    expect(formatGnf(0)).toBe('0\u00A0GNF')
  })

  it('l’espace entre le montant et la devise ne se coupe pas en fin de ligne', () => {
    expect(formatGnf(5000)).toMatch(/\d\u00A0GNF$/)
  })
})
