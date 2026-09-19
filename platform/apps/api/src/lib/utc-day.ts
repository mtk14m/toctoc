/**
 * Minuit UTC du jour de `date`. La Guinée est en UTC toute l'année (pas d'heure d'été) :
 * le jour d'une livraison à Conakry est donc son jour UTC, sans décalage à gérer.
 */
export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
