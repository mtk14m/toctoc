import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { PartnerService } from '../services/partner.js'

export interface PartnerRoutesOptions {
  partners: PartnerService
}

/** Liste des partenaires actifs : le relais en choisit un en créant son lien. */
export const partnerRoutes: FastifyPluginAsync<PartnerRoutesOptions> = async (
  app,
  { partners },
) => {
  app.get('/', { onRequest: [app.authenticate] }, async () => {
    return ok({ partners: await partners.listActivePartners() })
  })
}

// Le calcul de commission se fait en points de base entiers (voir services/pricing) :
// un taux à plus de 4 décimales serait arrondi en silence, autant le refuser.
const commissionRate = z
  .number()
  .min(0)
  .max(1)
  .refine((rate) => Math.round(rate * 10_000) / 10_000 === rate, 'au plus 4 décimales')

const createPartnerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['RESTAURANT', 'CUISINE_MAISON']),
  phone: z.string().min(1).max(25),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  commissionRate: commissionRate.optional(),
})

const createMenuItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300).optional(),
  price: z.number().int().min(1).max(10_000_000),
  photoUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .optional(),
  availableDate: z.iso.date().transform((value) => new Date(value)),
})

const partnerParams = z.object({ partnerId: z.string().min(1).max(64) })

/** Actions de l'équipe TocToc (ADMIN_PLATFORM) : tout ce plugin est protégé par la garde de rôle. */
export const adminPartnerRoutes: FastifyPluginAsync<PartnerRoutesOptions> = async (
  app,
  { partners },
) => {
  app.addHook('onRequest', app.requireRole('ADMIN_PLATFORM'))

  app.post('/partners', async (req, reply) => {
    const body = createPartnerSchema.parse(req.body)
    const partner = await partners.createPartner(body)
    return reply.code(201).send(ok({ partner }))
  })

  app.post('/partners/:partnerId/menu-items', async (req, reply) => {
    const { partnerId } = partnerParams.parse(req.params)
    const body = createMenuItemSchema.parse(req.body)
    const menuItem = await partners.addMenuItem(partnerId, body)
    return reply.code(201).send(ok({ menuItem }))
  })
}
