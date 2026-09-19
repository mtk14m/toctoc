import type { Redis } from 'ioredis'

export interface RateLimiter {
  /** Compte un événement pour `key` dans une fenêtre de `windowSeconds`, et renvoie le total. */
  hit(key: string, windowSeconds: number): Promise<number>
}

/**
 * Fenêtre fixe : INCR puis EXPIRE ... NX dans une seule transaction.
 * NX pose l'expiration uniquement si la clé n'en a pas encore : la fenêtre part du premier
 * événement, et une clé ne peut jamais rester sans expiration (contrairement à INCR puis EXPIRE
 * séparés, où un crash entre les deux la laisserait bloquée pour toujours).
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec()

    const [error, count] = results?.[0] ?? []
    if (error) throw error
    if (typeof count !== 'number') {
      throw new Error('Redis : réponse inattendue du limiteur de débit')
    }
    return count
  }
}
