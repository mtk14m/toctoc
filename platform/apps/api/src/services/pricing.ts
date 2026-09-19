/**
 * Calculs d'argent d'une commande (docs/04-modele-economique.md, docs/08-schema-donnees.md).
 *
 * Fonctions pures, sans base ni HTTP : elles ne font que calculer. Tous les montants sont
 * des entiers en GNF. C'est l'appelant qui fige le résultat sur l'OrderItem à sa création.
 */

export interface DeliveryFeeTier {
  /** Premier rang (1 = première commande du lien) auquel ce tarif s'applique. */
  readonly fromRank: number
  readonly fee: number
}

/** Valeurs d'hypothèse du doc 04, à ajuster avec les vrais chiffres de Conakry. */
export const DEFAULT_DELIVERY_FEE_TIERS: readonly DeliveryFeeTier[] = [
  { fromRank: 1, fee: 6000 },
  { fromRank: 3, fee: 5000 },
  { fromRank: 6, fee: 4000 },
  { fromRank: 10, fee: 3000 }, // plancher : ne baisse plus, la capacité d'une tournée est atteinte
]

const BASIS_POINTS = 10_000

function assertInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} doit être un entier ≥ ${min} (reçu : ${value})`)
  }
}

function assertValidTiers(tiers: readonly DeliveryFeeTier[]): void {
  if (tiers.length === 0 || tiers[0]?.fromRank !== 1) {
    throw new RangeError('les paliers doivent exister et commencer au rang 1')
  }

  tiers.forEach((tier, index) => {
    assertInteger('fee', tier.fee, 0)
    const previous = tiers[index - 1]
    if (previous && tier.fromRank <= previous.fromRank) {
      throw new RangeError('les paliers doivent avoir des rangs strictement croissants')
    }
  })
}

/**
 * Frais de livraison d'une commande selon son rang sur le lien.
 * Le rang est déterminé une fois, à la création, et jamais recalculé ensuite.
 */
export function deliveryFeeForRank(
  rank: number,
  tiers: readonly DeliveryFeeTier[] = DEFAULT_DELIVERY_FEE_TIERS,
): number {
  assertInteger('rank', rank, 1)
  assertValidTiers(tiers)

  const applicable = tiers.filter((tier) => tier.fromRank <= rank).at(-1)
  // Le premier palier commence au rang 1 (vérifié ci-dessus), donc il y en a toujours un.
  return applicable!.fee
}

/**
 * Commission TocToc sur une ligne, arrondie à l'entier le plus proche (moitié vers le haut).
 *
 * Le calcul se fait en points de base entiers : `Math.round(prix * taux)` se trompe sur des
 * flottants (1500 × 0.145 vaut 217.4999… au lieu de 217.5, donc 217 au lieu de 218).
 * Le taux est donc pris à 4 décimales près (0.145 → 1450 points de base).
 */
export function computeCommission(
  unitPrice: number,
  quantity: number,
  commissionRate: number,
): number {
  assertInteger('unitPrice', unitPrice, 0)
  assertInteger('quantity', quantity, 1)
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
    throw new RangeError(`commissionRate doit être compris entre 0 et 1 (reçu : ${commissionRate})`)
  }

  const rateInBasisPoints = Math.round(commissionRate * BASIS_POINTS)
  return Math.round((unitPrice * quantity * rateInBasisPoints) / BASIS_POINTS)
}

/** Montant d'un paiement : le plat et la part de livraison en une seule transaction mobile money. */
export function computePaymentAmount(input: {
  unitPrice: number
  quantity: number
  deliveryFee: number
}): number {
  assertInteger('unitPrice', input.unitPrice, 0)
  assertInteger('quantity', input.quantity, 1)
  assertInteger('deliveryFee', input.deliveryFee, 0)

  return input.unitPrice * input.quantity + input.deliveryFee
}

export interface OrderItemPrice {
  rank: number
  unitPrice: number
  deliveryFee: number
  commissionAmount: number
  amount: number
}

/**
 * Tout ce qu'il faut figer sur un OrderItem à sa création.
 * `existingActiveOrderItems` = nombre d'OrderItem non annulés déjà sur le lien.
 */
export function priceOrderItem(input: {
  unitPrice: number
  quantity: number
  commissionRate: number
  existingActiveOrderItems: number
  tiers?: readonly DeliveryFeeTier[]
}): OrderItemPrice {
  assertInteger('existingActiveOrderItems', input.existingActiveOrderItems, 0)

  const rank = input.existingActiveOrderItems + 1
  const deliveryFee = deliveryFeeForRank(rank, input.tiers)
  const commissionAmount = computeCommission(input.unitPrice, input.quantity, input.commissionRate)
  const amount = computePaymentAmount({
    unitPrice: input.unitPrice,
    quantity: input.quantity,
    deliveryFee,
  })

  return { rank, unitPrice: input.unitPrice, deliveryFee, commissionAmount, amount }
}
