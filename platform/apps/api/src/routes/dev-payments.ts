import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { PaymentSimulator } from '../services/payment-simulator.js'

const idParams = z.object({ id: z.string().min(1).max(64) })
const simulateSchema = z.object({ outcome: z.enum(['CONFIRMED', 'FAILED']).default('CONFIRMED') })

export interface DevPaymentRoutesOptions {
  simulator: PaymentSimulator
}

/**
 * Le raccourci de développement (`ENABLE_PAYMENT_SIMULATOR`) : payer une part sans opérateur.
 * Enregistré uniquement quand le drapeau est levé : sinon la route n'existe pas.
 */
export const devPaymentRoutes: FastifyPluginAsync<DevPaymentRoutesOptions> = async (
  app,
  { simulator },
) => {
  app.post('/order-items/:id/payment', async (req) => {
    const { id } = idParams.parse(req.params)
    const { outcome } = simulateSchema.parse(req.body ?? {})
    return ok({ outcome: await simulator.simulate(id, outcome) })
  })
}
