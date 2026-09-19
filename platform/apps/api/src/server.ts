import { buildApp } from './app.js'
import { createProductionDeps } from './composition.js'
import { loadConfig } from './lib/config.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'

const config = loadConfig()

// Redis en premier : plugins et jobs en dépendent (rate limit, BullMQ).
if (redis.status === 'wait' || redis.status === 'end') {
  await redis.connect()
}
// Prisma est paresseux : on force la connexion pour échouer au boot plutôt qu'à la première requête.
await prisma.$connect()

const app = await buildApp(config, createProductionDeps(config))

if (config.nodeEnv === 'production' && config.otpDelivery === 'console') {
  app.log.warn(
    'OTP_DELIVERY=console en production : les codes de connexion sont écrits dans les logs. ' +
      'À réserver au pilote interne, jamais avec de vrais clients.',
  )
}

// Arrêt propre : on cesse d'accepter des requêtes, on laisse finir celles en cours, puis on ferme les connexions.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Arrêt en cours')
    await app.close()
    await prisma.$disconnect()
    await redis.quit()
    process.exit(0)
  })
}

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
