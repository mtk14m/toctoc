import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { RestaurantService } from '../services/restaurant.js'

export interface RestaurantRoutesOptions {
  restaurants: RestaurantService
}

const restaurantParams = z.object({ id: z.string().min(1).max(64) })

// La disponibilité dépend de l'heure : une trentaine de secondes de cache suffit à alléger le
// serveur et le réseau (la 3G de Conakry) sans afficher un restaurant ouvert alors qu'il ferme.
const CACHE = 'public, max-age=30'

/**
 * L'annuaire public : n'importe qui, connecté ou non, peut parcourir les restaurants et voir leur
 * menu du jour avant de commencer une commande (docs/12).
 */
export const restaurantRoutes: FastifyPluginAsync<RestaurantRoutesOptions> = async (
  app,
  { restaurants },
) => {
  app.get('/', async (_req, reply) => {
    reply.header('cache-control', CACHE)
    return ok({ restaurants: await restaurants.list() })
  })

  app.get('/:id', async (req, reply) => {
    const { id } = restaurantParams.parse(req.params)
    reply.header('cache-control', CACHE)
    return ok({ restaurant: await restaurants.get(id) })
  })
}
