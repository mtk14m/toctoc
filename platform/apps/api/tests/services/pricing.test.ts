import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DELIVERY_FEE_TIERS,
  computeCommission,
  computePaymentAmount,
  deliveryFeeForRank,
  priceOrderItem,
} from '../../src/services/pricing.js'

describe('deliveryFeeForRank — tarif dégressif par palier (docs/04)', () => {
  it.each([
    [1, 6000],
    [2, 6000],
    [3, 5000],
    [5, 5000],
    [6, 4000],
    [9, 4000],
    [10, 3000],
  ])('la commande n°%i paie %i GNF', (rank, expected) => {
    expect(deliveryFeeForRank(rank)).toBe(expected)
  })

  it('plafonne au tarif plancher, quel que soit le nombre de participants', () => {
    expect(deliveryFeeForRank(11)).toBe(3000)
    expect(deliveryFeeForRank(500)).toBe(3000)
  })

  it('n’augmente jamais quand le rang augmente', () => {
    const fees = Array.from({ length: 40 }, (_, i) => deliveryFeeForRank(i + 1))

    for (let i = 1; i < fees.length; i++) {
      expect(fees[i]).toBeLessThanOrEqual(fees[i - 1]!)
    }
  })

  it('refuse un rang qui n’est pas un entier ≥ 1', () => {
    expect(() => deliveryFeeForRank(0)).toThrow(RangeError)
    expect(() => deliveryFeeForRank(-3)).toThrow(RangeError)
    expect(() => deliveryFeeForRank(2.5)).toThrow(RangeError)
    expect(() => deliveryFeeForRank(Number.NaN)).toThrow(RangeError)
  })

  it('accepte des paliers personnalisés (ce sont des valeurs de config à ajuster)', () => {
    const tiers = [
      { fromRank: 1, fee: 2000 },
      { fromRank: 4, fee: 1000 },
    ]

    expect(deliveryFeeForRank(3, tiers)).toBe(2000)
    expect(deliveryFeeForRank(4, tiers)).toBe(1000)
  })

  it('refuse des paliers mal formés', () => {
    expect(() => deliveryFeeForRank(1, [])).toThrow(RangeError)
    // ne commence pas au rang 1 : les premiers rangs n'auraient aucun tarif
    expect(() => deliveryFeeForRank(1, [{ fromRank: 2, fee: 1000 }])).toThrow(RangeError)
    // pas strictement croissants
    expect(() =>
      deliveryFeeForRank(1, [
        { fromRank: 1, fee: 2000 },
        { fromRank: 1, fee: 1000 },
      ]),
    ).toThrow(RangeError)
    // frais non entier
    expect(() => deliveryFeeForRank(1, [{ fromRank: 1, fee: 1000.5 }])).toThrow(RangeError)
  })

  it('les paliers par défaut sont valides', () => {
    expect(DEFAULT_DELIVERY_FEE_TIERS[0]?.fromRank).toBe(1)
  })
})

describe('computeCommission — arrondi explicite, en entiers', () => {
  it('applique le taux sur prix × quantité', () => {
    expect(computeCommission(25000, 1, 0.15)).toBe(3750)
    expect(computeCommission(25000, 3, 0.15)).toBe(11250)
  })

  it('arrondit la moitié vers le haut', () => {
    // 1500 × 0.145 = 217,5 exactement → 218
    expect(computeCommission(1500, 1, 0.145)).toBe(218)
    expect(computeCommission(10, 1, 0.15)).toBe(2) // 1,5 → 2
  })

  it('n’est pas victime de l’imprécision des flottants', () => {
    // Math.round(1500 * 0.145) donne 217 en JavaScript (le produit vaut 217,49999…)
    expect(Math.round(1500 * 0.145)).toBe(217)
    expect(computeCommission(1500, 1, 0.145)).toBe(218)
    expect(computeCommission(2900, 1, 0.145)).toBe(421)
  })

  it('renvoie 0 pour un taux de 0 et le prix entier pour un taux de 1', () => {
    expect(computeCommission(25000, 2, 0)).toBe(0)
    expect(computeCommission(25000, 2, 1)).toBe(50000)
  })

  it('refuse des entrées invalides', () => {
    expect(() => computeCommission(-1, 1, 0.15)).toThrow(RangeError)
    expect(() => computeCommission(25000.5, 1, 0.15)).toThrow(RangeError)
    expect(() => computeCommission(25000, 0, 0.15)).toThrow(RangeError)
    expect(() => computeCommission(25000, 1.5, 0.15)).toThrow(RangeError)
    expect(() => computeCommission(25000, 1, -0.1)).toThrow(RangeError)
    expect(() => computeCommission(25000, 1, 1.1)).toThrow(RangeError)
  })
})

describe('computePaymentAmount', () => {
  it('= (prix × quantité) + frais de livraison, en une seule transaction', () => {
    expect(computePaymentAmount({ unitPrice: 25000, quantity: 1, deliveryFee: 6000 })).toBe(31000)
    expect(computePaymentAmount({ unitPrice: 25000, quantity: 2, deliveryFee: 5000 })).toBe(55000)
  })

  it('refuse des entrées invalides', () => {
    expect(() =>
      computePaymentAmount({ unitPrice: 25000, quantity: 0, deliveryFee: 6000 }),
    ).toThrow(RangeError)
    expect(() => computePaymentAmount({ unitPrice: 25000, quantity: 1, deliveryFee: -1 })).toThrow(
      RangeError,
    )
  })
})

describe('priceOrderItem — ce qu’on fige sur un OrderItem à sa création', () => {
  it('la première commande sur un lien vide est au rang 1', () => {
    expect(
      priceOrderItem({
        unitPrice: 25000,
        quantity: 1,
        commissionRate: 0.15,
        existingActiveOrderItems: 0,
      }),
    ).toEqual({
      rank: 1,
      unitPrice: 25000,
      deliveryFee: 6000,
      commissionAmount: 3750,
      amount: 31000,
    })
  })

  it('le rang vient du nombre de commandes non annulées déjà sur le lien', () => {
    const price = priceOrderItem({
      unitPrice: 25000,
      quantity: 2,
      commissionRate: 0.15,
      existingActiveOrderItems: 5, // ce sera la 6ᵉ → palier 4 000
    })

    expect(price.rank).toBe(6)
    expect(price.deliveryFee).toBe(4000)
    expect(price.commissionAmount).toBe(7500)
    expect(price.amount).toBe(54000)
  })

  it('refuse un nombre de commandes existantes invalide', () => {
    expect(() =>
      priceOrderItem({
        unitPrice: 25000,
        quantity: 1,
        commissionRate: 0.15,
        existingActiveOrderItems: -1,
      }),
    ).toThrow(RangeError)
  })
})
