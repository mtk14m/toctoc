const NARROW_NBSP = '\u202F'
const NBSP = '\u00A0'

/** 31000 → « 31 000 GNF ». Les milliers et la devise ne se coupent jamais en fin de ligne. */
export function formatGnf(amount: number): string {
  const digits = Math.round(amount).toString()
  return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP)}${NBSP}GNF`
}
