import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { RedisRateLimiter } from '../../src/lib/rate-limiter.js'

function fakeRedis(execResult: unknown) {
  const calls: Array<[string, ...unknown[]]> = []
  const chain = {
    incr: (...args: unknown[]) => (calls.push(['incr', ...args]), chain),
    expire: (...args: unknown[]) => (calls.push(['expire', ...args]), chain),
    exec: vi.fn(async () => execResult),
  }
  return { redis: { multi: () => chain } as unknown as Redis, calls }
}

describe('RedisRateLimiter', () => {
  it('incrémente le compteur et pose l’expiration une seule fois (NX), en une transaction', async () => {
    const { redis, calls } = fakeRedis([
      [null, 2],
      [null, 0],
    ])

    const count = await new RedisRateLimiter(redis).hit('otp:requests:+224621000000', 600)

    expect(count).toBe(2)
    expect(calls).toEqual([
      ['incr', 'otp:requests:+224621000000'],
      ['expire', 'otp:requests:+224621000000', 600, 'NX'],
    ])
  })

  it('échoue plutôt que de laisser passer si Redis ne répond pas correctement', async () => {
    const { redis } = fakeRedis(null)

    await expect(new RedisRateLimiter(redis).hit('k', 60)).rejects.toThrow(/Redis/)
  })

  it('échoue si INCR renvoie une erreur', async () => {
    const { redis } = fakeRedis([[new Error('READONLY'), null]])

    await expect(new RedisRateLimiter(redis).hit('k', 60)).rejects.toThrow(/READONLY|Redis/)
  })
})
