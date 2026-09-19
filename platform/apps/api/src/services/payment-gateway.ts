import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { safeEqual } from '../lib/safe-equal.js'
import type { PaymentEvent, PaymentGateway, PaymentInitiation, WebhookRequest } from './payment.js'

const SIGNATURE_HEADER = 'x-toctoc-signature'

const eventSchema = z.object({
  reference: z.string().min(1),
  providerTransactionId: z.string().min(1),
  amount: z.number().int().min(0),
  status: z.enum(['CONFIRMED', 'FAILED']),
})

/** HMAC-SHA256 hexadécimal du corps brut : c'est ce que l'émetteur du webhook doit envoyer. */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

/**
 * Passerelle de développement : aucun opérateur derrière, `initiate` accepte tout. Les webhooks,
 * eux, sont vérifiés comme le seront ceux d'un vrai opérateur (signature HMAC du corps brut) :
 * on simule un paiement en envoyant soi-même un évènement signé (voir platform/README.md).
 * Jamais pour de vrais clients : n'importe qui connaissant le secret peut « payer ».
 */
export class FakePaymentGateway implements PaymentGateway {
  constructor(private readonly options: { webhookSecret: string }) {}

  async initiate(_input: PaymentInitiation): Promise<void> {}

  parseWebhook({ rawBody, headers }: WebhookRequest): PaymentEvent {
    const signature = headers[SIGNATURE_HEADER]
    const expected = signPayload(this.options.webhookSecret, rawBody)
    if (typeof signature !== 'string' || !safeEqual(signature, expected)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Signature invalide')
    }

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      throw new AppError(400, 'BAD_REQUEST', 'Corps de requête invalide')
    }
    return eventSchema.parse(json)
  }
}
