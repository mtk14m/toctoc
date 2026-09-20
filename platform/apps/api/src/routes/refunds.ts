import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ok } from '../lib/response.js'
import type { RefundService } from '../services/refund.js'

const idParams = z.object({ orderItemId: z.string().min(1).max(64) })

// La référence de l'opération mobile money : c'est ce qui permet de retrouver le remboursement.
const refundedSchema = z.object({ reference: z.string().trim().min(3).max(100) })

export interface RefundRoutesOptions {
  refunds: RefundService
}

/** L'équipe TocToc : les paiements encaissés sans repas, à rembourser à la main. */
export const adminRefundRoutes: FastifyPluginAsync<RefundRoutesOptions> = async (
  app,
  { refunds },
) => {
  app.addHook('onRequest', app.requireRole('ADMIN_PLATFORM'))

  app.get('/refunds', async () => ok({ refunds: await refunds.listPending() }))

  app.post('/refunds/:orderItemId/refunded', async (req) => {
    const { orderItemId } = idParams.parse(req.params)
    const { reference } = refundedSchema.parse(req.body)
    return ok({ refund: await refunds.markRefunded(req.user.sub, orderItemId, reference) })
  })
}
