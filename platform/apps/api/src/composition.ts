import type { AppDeps } from './deps.js'
import type { Config } from './lib/config.js'
import { prisma } from './lib/prisma.js'
import { RedisRateLimiter } from './lib/rate-limiter.js'
import { redis } from './lib/redis.js'
import { ConsoleOtpSender } from './services/otp-sender.js'
import type { OtpSender } from './services/otp.js'
import { PrismaGroupOrderStore } from './stores/prisma-group-order-store.js'
import { PrismaOtpStore } from './stores/prisma-otp-store.js'
import { PrismaUserStore } from './stores/prisma-user-store.js'

function createOtpSender(config: Config): OtpSender {
  switch (config.otpDelivery) {
    case 'console':
      return new ConsoleOtpSender()
  }
}

/** Branche les vraies dépendances (Prisma, Redis). Utilisé uniquement par server.ts. */
export function createProductionDeps(config: Config): AppDeps {
  return {
    otpStore: new PrismaOtpStore(prisma),
    userStore: new PrismaUserStore(prisma),
    groupOrderStore: new PrismaGroupOrderStore(prisma),
    rateLimiter: new RedisRateLimiter(redis),
    otpSender: createOtpSender(config),
  }
}
