import { z } from 'zod'

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
  })
  .superRefine((env, ctx) => {
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
  }
}
