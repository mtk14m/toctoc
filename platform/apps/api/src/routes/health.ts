import type { FastifyPluginAsync } from 'fastify'
import { ok } from '../lib/response.js'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ok({ status: 'ok', timestamp: new Date().toISOString() }))
}
