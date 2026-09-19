import { timingSafeEqual } from 'node:crypto'

/** Comparaison en temps constant (codes, signatures) : ne révèle pas où les deux valeurs diffèrent. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
