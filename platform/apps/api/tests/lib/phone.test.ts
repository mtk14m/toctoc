import { describe, expect, it } from 'vitest'
import { isValidPhone, normalizePhone } from '../../src/lib/phone.js'

describe('normalizePhone', () => {
  it('ajoute l’indicatif par défaut (Guinée +224) à un numéro local de 9 chiffres', () => {
    expect(normalizePhone('621000000')).toBe('+224621000000')
  })

  it('ignore les espaces, points et tirets', () => {
    expect(normalizePhone('621 00 00 00')).toBe('+224621000000')
    expect(normalizePhone('621-00-00-00')).toBe('+224621000000')
    expect(normalizePhone('(621) 00.00.00')).toBe('+224621000000')
  })

  it('garde un numéro déjà au format international', () => {
    expect(normalizePhone('+224 621 00 00 00')).toBe('+224621000000')
    expect(normalizePhone('+221771234567')).toBe('+221771234567')
  })

  it('convertit le préfixe 00 en +', () => {
    expect(normalizePhone('00224621000000')).toBe('+224621000000')
  })

  it('accepte un numéro qui commence par l’indicatif sans le +', () => {
    expect(normalizePhone('224621000000')).toBe('+224621000000')
  })

  it('utilise l’indicatif fourni pour un numéro local', () => {
    expect(normalizePhone('771234567', '221')).toBe('+221771234567')
  })

  it('laisse tel quel (donc invalide) ce qu’il ne sait pas interpréter', () => {
    expect(isValidPhone(normalizePhone('12'))).toBe(false)
    expect(isValidPhone(normalizePhone('abc'))).toBe(false)
  })
})

describe('isValidPhone', () => {
  it('accepte le format E.164', () => {
    expect(isValidPhone('+224621000000')).toBe(true)
    expect(isValidPhone('+221771234567')).toBe(true)
  })

  it('refuse ce qui n’est pas E.164', () => {
    expect(isValidPhone('621000000')).toBe(false)
    expect(isValidPhone('+0621000000')).toBe(false)
    expect(isValidPhone('+22462100000000000')).toBe(false)
    expect(isValidPhone('+224 621 00 00 00')).toBe(false)
    expect(isValidPhone('')).toBe(false)
  })
})
