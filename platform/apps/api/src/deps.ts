import type { RateLimiter } from './lib/rate-limiter.js'
import type { UserStore } from './services/auth.js'
import type { GroupOrderStore } from './services/group-order.js'
import type { OtpSender, OtpStore } from './services/otp.js'

/**
 * Tout ce que l'application utilise pour parler au monde extérieur (base, Redis, envoi de code).
 * `buildApp` le reçoit en paramètre : en production ce sont Prisma et Redis, dans les tests
 * des implémentations en mémoire — pas besoin de base pour tester une route.
 */
export interface AppDeps {
  otpStore: OtpStore
  userStore: UserStore
  groupOrderStore: GroupOrderStore
  rateLimiter: RateLimiter
  otpSender: OtpSender
}
