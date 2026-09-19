import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import type { AppDeps } from './deps.js'
import type { Config } from './lib/config.js'
import { authenticate } from './plugins/authenticate.js'
import { registerErrorHandling } from './plugins/error-handler.js'
import { authRoutes } from './routes/auth.js'
import { healthRoutes } from './routes/health.js'
import { createAuthService } from './services/auth.js'
import { createOtpService } from './services/otp.js'

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
  const app = Fastify({ logger: loggerOptions(config) })

  registerErrorHandling(app)

  await app.register(helmet)
  await app.register(cors, { origin: config.corsOrigins, credentials: true })
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '7d' } })
  app.decorate('authenticate', authenticate)

  const otp = createOtpService({
    store: deps.otpStore,
    sender: deps.otpSender,
    rateLimiter: deps.rateLimiter,
    secret: config.jwtSecret,
  })
  const authService = createAuthService({ otp, users: deps.userStore })

  await app.register(healthRoutes)
  await app.register(authRoutes, {
    prefix: '/auth',
    otp,
    authService,
    userStore: deps.userStore,
    defaultCountryCode: config.defaultCountryCode,
  })

  return app
}
