import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { ok } from '../lib/response.js'
import type { GroupOrderService, OrderCreator } from '../services/group-order.js'

// Les heures ne se choisissent pas : la commande reste ouverte 20 minutes, puis la livraison
// suit (voir services/schedule.ts). Une heure envoyée par le client serait ignorée.
const createGroupOrderSchema = z.object({
  partnerId: z.string().min(1).max(64),
  deliveryAddress: z.string().trim().min(1).max(200),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  paymentMode: z.enum(['SPLIT', 'HOST_PAYS']).optional(),
  // Sans jeton : l'identité de celui qui commence la commande, comme pour rejoindre.
  phone: z.string().min(1).max(25).optional(),
  name: z.string().trim().min(1).max(100).optional(),
})

const shareTokenParams = z.object({ shareToken: z.string().min(1).max(64) })

export interface GroupOrderRoutesOptions {
  groupOrders: GroupOrderService
}

export const groupOrderRoutes: FastifyPluginAsync<GroupOrderRoutesOptions> = async (
  app,
  { groupOrders },
) => {
  // Ouvert à tout le monde : commencer une commande, seul ou pour la partager, ne demande ni compte
  // ni OTP (docs/06). Un jeton, s'il est envoyé, doit être valide : on ne l'ignore pas en silence.
  app.post('/', async (req, reply) => {
    const { phone, name, ...input } = createGroupOrderSchema.parse(req.body)

    let creator: OrderCreator
    if (req.headers.authorization) {
      await app.authenticate(req)
      creator = { userId: req.user.sub }
    } else if (phone && name) {
      creator = { phone, name, clientIp: req.ip }
    } else {
      throw new AppError(400, 'VALIDATION_ERROR', 'Données invalides', [
        { path: ['phone', 'name'], message: 'requis sans connexion' },
      ])
    }

    const groupOrder = await groupOrders.create(creator, input)
    return reply.code(201).send(ok({ groupOrder }))
  })

  // Public : celui qui reçoit le lien le voit sans compte (docs/06, « rejoindre et choisir »).
  app.get('/:shareToken', async (req) => {
    const { shareToken } = shareTokenParams.parse(req.params)
    return ok({ groupOrder: await groupOrders.getByShareToken(shareToken) })
  })
}
