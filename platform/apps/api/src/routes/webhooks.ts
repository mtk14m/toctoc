import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '../lib/errors.js'
import { ok } from '../lib/response.js'
import type { PaymentService } from '../services/payment.js'

export interface WebhookRoutesOptions {
  payments: PaymentService
}

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (
  app,
  { payments },
) => {
  // La signature se calcule sur les octets reçus : on garde le corps brut au lieu du JSON parsé
  // (re-sérialisé, il ne serait plus identique). Ce parseur ne vaut que pour ce plugin.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  )

  // Pas de jeton ici : l'appelant est l'opérateur, authentifié par sa signature.
  app.post('/payments', async (req) => {
    if (typeof req.body !== 'string') {
      throw new AppError(400, 'BAD_REQUEST', 'Corps de requête invalide')
    }

    const outcome = await payments.handleWebhook({ rawBody: req.body, headers: req.headers })
    if (outcome === 'late') {
      // À traiter à la main (Phase 1) : le client a payé une commande qui n'est plus valable.
      req.log.warn(
        { outcome },
        'paiement encaissé après la fermeture du lien : remboursement à faire',
      )
    }
    return ok({ received: true })
  })
}
