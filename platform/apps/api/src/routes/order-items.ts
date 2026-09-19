import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { OrderItemService } from '../services/order-item.js'

const shareTokenParams = z.object({ shareToken: z.string().min(1).max(64) })

const joinSchema = z.object({
  menuItemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(10).default(1),
  phone: z.string().min(1).max(25),
  name: z.string().trim().min(1).max(100),
})

export interface OrderItemRoutesOptions {
  orderItems: OrderItemService
}

export const orderItemRoutes: FastifyPluginAsync<OrderItemRoutesOptions> = async (
  app,
  { orderItems },
) => {
  // Public : rejoindre un lien ne demande ni compte ni OTP (docs/06). Le paiement mobile money,
  // dont l'opérateur vérifie déjà le numéro, joue ce rôle.
  app.post('/:shareToken/items', async (req, reply) => {
    const { shareToken } = shareTokenParams.parse(req.params)
    const body = joinSchema.parse(req.body)
    const orderItem = await orderItems.join(shareToken, body, req.ip)
    return reply.code(201).send(ok({ orderItem }))
  })
}
