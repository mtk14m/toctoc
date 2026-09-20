/**
 * Les paliers de livraison affichés sur la page d'accueil. Ils reprennent
 * `DEFAULT_DELIVERY_FEE_TIERS` de l'API (apps/api/src/services/pricing.ts) : des valeurs
 * d'hypothèse à ajuster avec les vrais chiffres de Conakry. Le prix réellement facturé vient
 * toujours de l'API — ici on ne fait que l'expliquer.
 */
export const DELIVERY_FEE_LADDER = [
  { label: '1re – 2e personne', fee: 6000 },
  { label: '3e – 5e personne', fee: 5000 },
  { label: '6e – 9e personne', fee: 4000 },
  { label: 'Dès la 10e personne', fee: 3000 },
] as const
