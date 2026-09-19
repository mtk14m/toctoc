import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { GroupOrderService } from '../services/group-order.js'

const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value))

const createGroupOrderSchema = z.object({
  partnerId: z.string().min(1).max(64),
  deliveryAddress: z.string().trim().min(1).max(200),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  orderCutoffTime: isoDateTime,
  deliveryTime: isoDateTime,
  paymentMode: z.enum(['SPLIT', 'HOST_PAYS']).optional(),
})

const shareTokenParams = z.object({ shareToken: z.string().min(1).max(64) })

export interface GroupOrderRoutesOptions {
  groupOrders: GroupOrderService
}

export const groupOrderRoutes: FastifyPluginAsync<GroupOrderRoutesOptions> = async (
  app,
  { groupOrders },
) => {
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = createGroupOrderSchema.parse(req.body)
    const groupOrder = await groupOrders.create(req.user.sub, body)
    return reply.code(201).send(ok({ groupOrder }))
  })

  // Public : celui qui reçoit le lien le voit sans compte (docs/06, « rejoindre et choisir »).
  app.get('/:shareToken', async (req) => {
    const { shareToken } = shareTokenParams.parse(req.params)
    return ok({ groupOrder: await groupOrders.getByShareToken(shareToken) })
  })
}
