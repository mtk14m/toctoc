import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { PartnerService } from '../services/partner.js'
import { DEFAULT_SCHEDULE_RULES, formatClock, parseClock } from '../services/schedule.js'

const DEFAULT_START = DEFAULT_SCHEDULE_RULES.serviceStartMinute
const DEFAULT_END = DEFAULT_SCHEDULE_RULES.serviceEndMinute

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

// « HH:mm » (24:00 accepté pour la fin) : ce que l'équipe saisit, converti en minutes depuis minuit.
const clock = z
  .string()
  .refine((value) => parseClock(value) !== null, 'format HH:mm attendu, par exemple 11:30')
  .transform((value) => parseClock(value)!)

const createPartnerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['RESTAURANT', 'CUISINE_MAISON']),
    phone: z.string().min(1).max(25),
    address: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    commissionRate: commissionRate.optional(),
    serviceStart: clock.optional(),
    serviceEnd: clock.optional(),
  })
  .refine(
    ({ serviceStart = DEFAULT_START, serviceEnd = DEFAULT_END }) => serviceStart < serviceEnd,
    { path: ['serviceEnd'], message: 'la fin de service doit être après le début' },
  )
  // Les minutes vont au service ; l'API parle en « HH:mm ».
  .transform(({ serviceStart, serviceEnd, ...rest }) => ({
    ...rest,
    serviceStartMinute: serviceStart,
    serviceEndMinute: serviceEnd,
  }))

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
    const { serviceStartMinute, serviceEndMinute, ...partner } = await partners.createPartner(body)
    return reply.code(201).send(
      ok({
        partner: {
          ...partner,
          serviceStart: formatClock(serviceStartMinute),
          serviceEnd: formatClock(serviceEndMinute),
        },
      }),
    )
  })

  app.post('/partners/:partnerId/menu-items', async (req, reply) => {
    const { partnerId } = partnerParams.parse(req.params)
    const body = createMenuItemSchema.parse(req.body)
    const menuItem = await partners.addMenuItem(partnerId, body)
    return reply.code(201).send(ok({ menuItem }))
  })
}
