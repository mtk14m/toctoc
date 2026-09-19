import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 ne charge plus .env tout seul. On utilise le chargeur natif de Node (pas de dotenv).
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
})
