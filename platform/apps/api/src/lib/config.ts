import { z } from 'zod'

const envSchema = z.object({
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
})

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  redisUrl: string
  databaseUrl: string
  corsOrigins: string[]
}

/**
 * Valide les variables d'environnement une seule fois, au démarrage.
 * Une config invalide doit faire échouer le boot, pas produire un comportement flou plus tard.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)

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
  }
}
