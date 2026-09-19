import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import type { Config } from './lib/config.js'
import { registerErrorHandling } from './plugins/error-handler.js'
import { healthRoutes } from './routes/health.js'

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
 */
export async function buildApp(config: Config) {
  const app = Fastify({ logger: loggerOptions(config) })

  registerErrorHandling(app)

  await app.register(helmet)
  await app.register(cors, { origin: config.corsOrigins, credentials: true })

  await app.register(healthRoutes)

  return app
}
