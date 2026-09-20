import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import type { AppDeps } from './deps.js'
import type { Config } from './lib/config.js'
import { authenticate } from './plugins/authenticate.js'
import { registerErrorHandling } from './plugins/error-handler.js'
import { createRequireRole } from './plugins/require-role.js'
import { attachSocketServer } from './realtime/socket-server.js'
import { authRoutes } from './routes/auth.js'
import { groupOrderRoutes } from './routes/group-orders.js'
import { healthRoutes } from './routes/health.js'
import { adminDeliveryRoutes, driverRoutes } from './routes/deliveries.js'
import { devPaymentRoutes } from './routes/dev-payments.js'
import { orderItemRoutes } from './routes/order-items.js'
import { adminPartnerRoutes } from './routes/partners.js'
import { ratingRoutes } from './routes/ratings.js'
import { adminRefundRoutes } from './routes/refunds.js'
import { restaurantRoutes } from './routes/restaurants.js'
import { webhookRoutes } from './routes/webhooks.js'
import { createAuthService } from './services/auth.js'
import { createClosingService, type ClosingService } from './services/closing.js'
import { createDeliveryService } from './services/delivery.js'
import { createDriverService } from './services/driver.js'
import { createGroupOrderService } from './services/group-order.js'
import { createOrderItemService } from './services/order-item.js'
import { createOtpService } from './services/otp.js'
import { createPartnerService } from './services/partner.js'
import { createPaymentSimulator } from './services/payment-simulator.js'
import { createPaymentService } from './services/payment.js'
import { createRatingService } from './services/rating.js'
import { createRefundService } from './services/refund.js'
import { createRestaurantService } from './services/restaurant.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** La clôture des liens : `server.ts` la planifie (BullMQ), les tests l'appellent directement. */
    closingService: ClosingService
  }
}

function loggerOptions(config: Config) {
  switch (config.nodeEnv) {
    case 'production':
      return { level: 'info' }
    case 'test':
      return false
    default:
      return {
        level: 'debug',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }
  }
}

/**
 * Construit l'application sans écouter sur un port : les tests utilisent `app.inject()`,
 * `server.ts` s'occupe du démarrage réel (connexions, jobs, listen).
 * Les dépendances externes arrivent par `deps` (voir deps.ts).
 */
export async function buildApp(config: Config, deps: AppDeps) {
  const app = Fastify({ logger: loggerOptions(config), trustProxy: config.trustProxy })

  registerErrorHandling(app)

  await app.register(helmet)
  await app.register(cors, { origin: config.corsOrigins, credentials: true })
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '7d' } })
  app.decorate('authenticate', authenticate)
  app.decorate('requireRole', createRequireRole(deps.userStore))

  const otp = createOtpService({
    store: deps.otpStore,
    sender: deps.otpSender,
    rateLimiter: deps.rateLimiter,
    secret: config.jwtSecret,
  })
  const authService = createAuthService({ otp, users: deps.userStore })
  const groupOrders = createGroupOrderService({
    store: deps.groupOrderStore,
    users: deps.userStore,
    rateLimiter: deps.rateLimiter,
    defaultCountryCode: config.defaultCountryCode,
    rules: config.schedule,
    hostPaysEnabled: config.hostPaysEnabled,
    ...(deps.now && { now: deps.now }),
  })
  // Le temps réel s'attache au serveur HTTP de l'application : les tests `inject()` n'écoutent sur
  // aucun port, et un test qui veut de vrais sockets appelle `app.listen({ port: 0 })`.
  const realtime = attachSocketServer(app, {
    corsOrigins: config.corsOrigins,
    adapter: deps.socketAdapter,
    findGroupOrderId: async (shareToken) =>
      (await deps.groupOrderStore.findByShareToken(shareToken))?.id ?? null,
  })
  const payments = createPaymentService({
    store: deps.paymentStore,
    gateway: deps.paymentGateway,
    realtime,
    onError: (err) => app.log.error({ err }, 'temps réel : annonce impossible'),
  })
  app.decorate(
    'closingService',
    createClosingService({
      store: deps.closingStore,
      notifier: deps.partnerNotifier,
      realtime,
      onError: (err) => app.log.error({ err }, 'clôture : un lien n’a pas pu être traité'),
    }),
  )
  const deliveries = createDeliveryService({
    store: deps.deliveryStore,
    realtime,
    onError: (err) => app.log.error({ err }, 'livraison : annonce impossible'),
  })
  const drivers = createDriverService({
    store: deps.driverStore,
    defaultCountryCode: config.defaultCountryCode,
  })
  const orderItems = createOrderItemService({
    store: deps.orderItemStore,
    users: deps.userStore,
    payments,
    realtime,
    rateLimiter: deps.rateLimiter,
    defaultCountryCode: config.defaultCountryCode,
  })
  const ratings = createRatingService({
    store: deps.ratingStore,
    realtime,
    rateLimiter: deps.rateLimiter,
    defaultCountryCode: config.defaultCountryCode,
  })
  const refunds = createRefundService({ store: deps.refundStore })
  const restaurants = createRestaurantService({
    store: deps.restaurantStore,
    rules: config.schedule,
    ...(deps.now && { now: deps.now }),
  })
  const partners = createPartnerService({
    store: deps.partnerStore,
    defaultCountryCode: config.defaultCountryCode,
  })

  await app.register(healthRoutes)
  await app.register(authRoutes, {
    prefix: '/auth',
    otp,
    authService,
    userStore: deps.userStore,
    defaultCountryCode: config.defaultCountryCode,
  })
  await app.register(groupOrderRoutes, { prefix: '/group-orders', groupOrders })
  await app.register(orderItemRoutes, { prefix: '/group-orders', orderItems })
  await app.register(ratingRoutes, { prefix: '/order-items', ratings })
  await app.register(restaurantRoutes, { prefix: '/restaurants', restaurants })
  await app.register(adminPartnerRoutes, { prefix: '/admin', partners })
  await app.register(adminRefundRoutes, { prefix: '/admin', refunds })
  await app.register(adminDeliveryRoutes, { prefix: '/admin', deliveries, drivers })
  await app.register(driverRoutes, { prefix: '/driver', deliveries, drivers })
  await app.register(webhookRoutes, { prefix: '/webhooks', payments })
  if (config.paymentSimulatorEnabled) {
    const simulator = createPaymentSimulator({
      store: deps.paymentStore,
      payments,
      webhookSecret: config.paymentWebhookSecret,
    })
    await app.register(devPaymentRoutes, { prefix: '/dev', simulator })
  }

  return app
}
