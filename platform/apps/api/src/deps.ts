import type { RateLimiter } from './lib/rate-limiter.js'
import type { UserStore } from './services/auth.js'
import type { GroupOrderStore } from './services/group-order.js'
import type { OrderItemStore } from './services/order-item.js'
import type { OtpSender, OtpStore } from './services/otp.js'
import type { PartnerStore } from './services/partner.js'

/**
 * Tout ce que l'application utilise pour parler au monde extérieur (base, Redis, envoi de code).
 * `buildApp` le reçoit en paramètre : en production ce sont Prisma et Redis, dans les tests
 * des implémentations en mémoire — pas besoin de base pour tester une route.
 */
export interface AppDeps {
  otpStore: OtpStore
  userStore: UserStore
  groupOrderStore: GroupOrderStore
  orderItemStore: OrderItemStore
  partnerStore: PartnerStore
  rateLimiter: RateLimiter
  otpSender: OtpSender
}
