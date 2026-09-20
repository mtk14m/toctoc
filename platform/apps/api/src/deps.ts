import type { ServerOptions } from 'socket.io'
import type { RateLimiter } from './lib/rate-limiter.js'
import type { UserStore } from './services/auth.js'
import type { ClosingStore } from './services/closing.js'
import type { GroupOrderStore } from './services/group-order.js'
import type { OrderItemStore } from './services/order-item.js'
import type { OtpSender, OtpStore } from './services/otp.js'
import type { PartnerNotifier } from './services/partner-notifier.js'
import type { PartnerStore } from './services/partner.js'
import type { PaymentGateway, PaymentStore } from './services/payment.js'
import type { RestaurantStore } from './services/restaurant.js'

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
  restaurantStore: RestaurantStore
  paymentStore: PaymentStore
  paymentGateway: PaymentGateway
  closingStore: ClosingStore
  partnerNotifier: PartnerNotifier
  rateLimiter: RateLimiter
  otpSender: OtpSender
  /** L'horloge : les tests la fixent pour ne pas dépendre de l'heure à laquelle ils tournent. */
  now?: (() => Date) | undefined
  /** Adaptateur Socket.io (Redis en production) ; sans lui, une seule instance de l'API diffuse. */
  socketAdapter?: ServerOptions['adapter'] | undefined
}
