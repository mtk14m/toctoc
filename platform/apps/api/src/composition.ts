import { createAdapter } from '@socket.io/redis-adapter'
import type { AppDeps } from './deps.js'
import type { Config } from './lib/config.js'
import { prisma } from './lib/prisma.js'
import { RedisRateLimiter } from './lib/rate-limiter.js'
import { redis } from './lib/redis.js'
import { ConsoleOtpSender } from './services/otp-sender.js'
import type { OtpSender } from './services/otp.js'
import { ConsolePartnerNotifier, type PartnerNotifier } from './services/partner-notifier.js'
import { FakePaymentGateway } from './services/payment-gateway.js'
import type { PaymentGateway } from './services/payment.js'
import { PrismaClosingStore } from './stores/prisma-closing-store.js'
import { PrismaGroupOrderStore } from './stores/prisma-group-order-store.js'
import { PrismaOrderItemStore } from './stores/prisma-order-item-store.js'
import { PrismaOtpStore } from './stores/prisma-otp-store.js'
import { PrismaPartnerStore } from './stores/prisma-partner-store.js'
import { PrismaPaymentStore } from './stores/prisma-payment-store.js'
import { PrismaRestaurantStore } from './stores/prisma-restaurant-store.js'
import { PrismaUserStore } from './stores/prisma-user-store.js'

function createOtpSender(config: Config): OtpSender {
  switch (config.otpDelivery) {
    case 'console':
      return new ConsoleOtpSender()
  }
}

function createPartnerNotifier(config: Config): PartnerNotifier {
  switch (config.partnerNotification) {
    case 'console':
      return new ConsolePartnerNotifier()
  }
}

function createPaymentGateway(config: Config): PaymentGateway {
  switch (config.paymentProvider) {
    case 'fake':
      return new FakePaymentGateway({ webhookSecret: config.paymentWebhookSecret })
  }
}

/** Branche les vraies dépendances (Prisma, Redis). Utilisé uniquement par server.ts. */
export function createProductionDeps(config: Config): AppDeps {
  return {
    otpStore: new PrismaOtpStore(prisma),
    userStore: new PrismaUserStore(prisma),
    groupOrderStore: new PrismaGroupOrderStore(prisma),
    orderItemStore: new PrismaOrderItemStore(prisma),
    partnerStore: new PrismaPartnerStore(prisma),
    restaurantStore: new PrismaRestaurantStore(prisma),
    paymentStore: new PrismaPaymentStore(prisma),
    paymentGateway: createPaymentGateway(config),
    closingStore: new PrismaClosingStore(prisma),
    partnerNotifier: createPartnerNotifier(config),
    rateLimiter: new RedisRateLimiter(redis),
    otpSender: createOtpSender(config),
    // Deux connexions dédiées : un client Redis en mode abonné ne peut plus faire d'autres commandes.
    socketAdapter: createAdapter(redis.duplicate(), redis.duplicate()),
  }
}
