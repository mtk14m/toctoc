import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { RatingService } from '../services/rating.js'

const idParams = z.object({ id: z.string().min(1).max(64) })

const ratingSchema = z.object({
  phone: z.string().min(1).max(25),
  score: z.number().int().min(1).max(5),
})

export interface RatingRoutesOptions {
  ratings: RatingService
}

export const ratingRoutes: FastifyPluginAsync<RatingRoutesOptions> = async (app, { ratings }) => {
  // Public, comme rejoindre : le numéro de la part prouve que c'est bien la sienne (docs/06).
  app.post('/:id/rating', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const body = ratingSchema.parse(req.body)
    const rating = await ratings.rate(id, body, req.ip)
    return reply.code(201).send(ok({ rating }))
  })
}
