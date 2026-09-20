import { z } from 'zod'
import type { ScheduleRules } from '../services/schedule.js'

// Secrets utilisables uniquement hors production : en production, ils sont obligatoires.
const DEV_JWT_SECRET = 'dev-only-jwt-secret-do-not-use-in-production'
const DEV_PAYMENT_WEBHOOK_SECRET = 'dev-only-payment-webhook-secret-do-not-use'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    REDIS_URL: z.url().default('redis://localhost:6380'),
    DATABASE_URL: z.url().default('postgresql://toctoc:toctoc@localhost:5433/toctoc'),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    JWT_SECRET: z.string().min(32).optional(),
    // Canal d'envoi des codes OTP. Seul 'console' existe pour l'instant (le code est écrit dans
    // les logs) ; 'whatsapp' et 'sms' viendront avec leur fournisseur.
    OTP_DELIVERY: z.enum(['console']).default('console'),
    // Indicatif ajouté aux numéros saisis sans préfixe international (224 = Guinée).
    DEFAULT_COUNTRY_CODE: z
      .string()
      .regex(/^\d{1,3}$/, 'chiffres seulement, sans le +')
      .default('224'),
    // À activer uniquement quand l'API n'est joignable que par le reverse proxy (Caddy) : Fastify
    // lit alors l'IP du client dans X-Forwarded-For. Sans proxy, cet en-tête est falsifiable.
    TRUST_PROXY: z.stringbool().default(false),
    // Opérateur de mobile money. Seule la passerelle de développement existe pour l'instant (aucun
    // paiement réel) ; chaque opérateur réel s'ajoutera ici avec son implémentation.
    PAYMENT_PROVIDER: z.enum(['fake']).default('fake'),
    // Secret de signature des webhooks de paiement : seul l'opérateur (et nous) le connaît.
    PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
    // Canal d'envoi du récap au partenaire. Seul 'console' existe pour l'instant (le récap est écrit
    // dans les logs, l'équipe le transmet à la main) ; 'whatsapp' et 'sms' viendront avec leur fournisseur.
    PARTNER_NOTIFICATION: z.enum(['console']).default('console'),
    // Règles de temps d'une commande (voir services/schedule.ts). Les heures se donnent en heures
    // entières, en heure de Conakry (UTC) ; 24 = minuit.
    SERVICE_START_HOUR: z.coerce.number().int().min(0).max(23).default(9),
    SERVICE_END_HOUR: z.coerce.number().int().min(1).max(24).default(24),
    // Combien de temps un lien accepte des commandes après son lancement.
    ORDER_WINDOW_MINUTES: z.coerce.number().int().min(1).max(240).default(20),
    // De la fermeture de la commande à la livraison estimée : préparation et trajet.
    DELIVERY_LEAD_MINUTES: z.coerce.number().int().min(0).max(600).default(45),
    // Le règlement « j'invite tout le monde » (HOST_PAYS) reste refusé tant que la charge unique du
    // créateur n'est pas construite : sans elle, ces commandes ne se fermeraient jamais.
    ENABLE_HOST_PAYS: z.stringbool().default(false),
    // Un raccourci de développement : payer une part d'un simple appel, sans opérateur. Explicite,
    // jamais déduit de NODE_ENV (le stack Docker local tourne en production).
    ENABLE_PAYMENT_SIMULATOR: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    if (env.SERVICE_START_HOUR >= env.SERVICE_END_HOUR) {
      ctx.addIssue({
        code: 'custom',
        path: ['SERVICE_END_HOUR'],
        message: 'doit être après SERVICE_START_HOUR',
      })
    }
    if (env.NODE_ENV !== 'production') return
    for (const name of ['JWT_SECRET', 'PAYMENT_WEBHOOK_SECRET'] as const) {
      if (!env[name]) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'obligatoire en production' })
      }
    }
  })

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  redisUrl: string
  databaseUrl: string
  corsOrigins: string[]
  jwtSecret: string
  otpDelivery: 'console'
  defaultCountryCode: string
  trustProxy: boolean
  paymentProvider: 'fake'
  paymentWebhookSecret: string
  partnerNotification: 'console'
  schedule: ScheduleRules
  hostPaysEnabled: boolean
  paymentSimulatorEnabled: boolean
}

/**
 * Valide les variables d'environnement une seule fois, au démarrage.
 * Une config invalide doit faire échouer le boot, pas produire un comportement flou plus tard.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Une variable vide (`JWT_SECRET=` dans un .env, ou `${X:-}` dans Docker) vaut « non définie ».
  const definedEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
  const parsed = envSchema.safeParse(definedEnv)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Configuration invalide — ${details}`)
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    redisUrl: parsed.data.REDIS_URL,
    databaseUrl: parsed.data.DATABASE_URL,
    corsOrigins: parsed.data.CORS_ORIGIN,
    jwtSecret: parsed.data.JWT_SECRET ?? DEV_JWT_SECRET,
    otpDelivery: parsed.data.OTP_DELIVERY,
    defaultCountryCode: parsed.data.DEFAULT_COUNTRY_CODE,
    trustProxy: parsed.data.TRUST_PROXY,
    paymentProvider: parsed.data.PAYMENT_PROVIDER,
    paymentWebhookSecret: parsed.data.PAYMENT_WEBHOOK_SECRET ?? DEV_PAYMENT_WEBHOOK_SECRET,
    partnerNotification: parsed.data.PARTNER_NOTIFICATION,
    schedule: {
      serviceStartMinute: parsed.data.SERVICE_START_HOUR * 60,
      serviceEndMinute: parsed.data.SERVICE_END_HOUR * 60,
      orderWindowMinutes: parsed.data.ORDER_WINDOW_MINUTES,
      deliveryLeadMinutes: parsed.data.DELIVERY_LEAD_MINUTES,
    },
    hostPaysEnabled: parsed.data.ENABLE_HOST_PAYS,
    paymentSimulatorEnabled: parsed.data.ENABLE_PAYMENT_SIMULATOR,
  }
}
