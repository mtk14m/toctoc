import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { loadConfig } from './config.js'

// Singleton : évite d'ouvrir une nouvelle pool de connexions à chaque rechargement en dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient() {
  const config = loadConfig()

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    log:
      process.env['PRISMA_LOG_QUERIES'] === 'true' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma
