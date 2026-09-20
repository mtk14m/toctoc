import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { DeliveryService } from '../services/delivery.js'
import type { DriverService } from '../services/driver.js'

export interface DeliveryRoutesOptions {
  deliveries: DeliveryService
  drivers: DriverService
}

const idParams = z.object({ id: z.string().min(1).max(64) })

const createDriverSchema = z.object({
  phone: z.string().min(1).max(25),
  name: z.string().trim().min(1).max(100),
})
const assignSchema = z.object({ driverId: z.string().min(1).max(64) })
// Une vraie raison, pas « ok » : l'override doit rester lisible dans le journal d'audit.
const overrideSchema = z.object({ reason: z.string().trim().min(5).max(300) })

// Les statuts qu'on peut demander à la vue de l'équipe (séparés par des virgules).
const ORDER_STATUSES = ['OPEN', 'CLOSED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const
const ordersQuery = z.object({
  status: z
    .string()
    .transform((value) => value.split(',').map((status) => status.trim()))
    .pipe(z.array(z.enum(ORDER_STATUSES)).min(1))
    .default(['CLOSED', 'IN_DELIVERY']),
})

const confirmSchema = z.object({ code: z.string().regex(/^\d{4}$/, 'le code a 4 chiffres') })

/** L'équipe TocToc : livreurs, commandes à traiter, assignation et confirmation manuelle. */
export const adminDeliveryRoutes: FastifyPluginAsync<DeliveryRoutesOptions> = async (
  app,
  { deliveries, drivers },
) => {
  app.addHook('onRequest', app.requireRole('ADMIN_PLATFORM'))

  app.get('/drivers', async () => ok({ drivers: await drivers.listDrivers() }))

  app.post('/drivers', async (req, reply) => {
    const body = createDriverSchema.parse(req.body)
    return reply.code(201).send(ok({ driver: await drivers.createDriver(body) }))
  })

  app.get('/group-orders', async (req) => {
    const { status } = ordersQuery.parse(req.query)
    return ok({ orders: await deliveries.listOrders(status) })
  })

  app.post('/group-orders/:id/delivery', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const { driverId } = assignSchema.parse(req.body)
    const delivery = await deliveries.assign(req.user.sub, id, driverId)
    // 201 pour une première assignation, 200 quand on change de livreur.
    return reply.code(delivery.reassigned ? 200 : 201).send(ok({ delivery }))
  })

  app.post('/deliveries/:id/override', async (req) => {
    const { id } = idParams.parse(req.params)
    const { reason } = overrideSchema.parse(req.body)
    return ok({ delivery: await deliveries.override(req.user.sub, id, reason) })
  })
}

/** L'espace livreur : sa tournée, « récupéré », et la saisie du code de confirmation. */
export const driverRoutes: FastifyPluginAsync<DeliveryRoutesOptions> = async (
  app,
  { deliveries },
) => {
  app.addHook('onRequest', app.requireRole('DRIVER'))

  app.get('/deliveries', async (req) => {
    return ok({ deliveries: await deliveries.listForDriver(req.user.sub) })
  })

  app.post('/deliveries/:id/picked-up', async (req) => {
    const { id } = idParams.parse(req.params)
    return ok({ delivery: await deliveries.pickUp(req.user.sub, id) })
  })

  app.post('/deliveries/:id/confirm', async (req) => {
    const { id } = idParams.parse(req.params)
    const { code } = confirmSchema.parse(req.body)
    return ok(await deliveries.confirm(req.user.sub, id, code))
  })
}
