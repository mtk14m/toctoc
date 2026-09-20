import { AppError } from '../lib/errors.js'
import { SIGNATURE_HEADER, signPayload } from './payment-gateway.js'
import type { PaymentOutcome, PaymentService, PaymentStore } from './payment.js'

export interface PaymentSimulatorDeps {
  store: Pick<PaymentStore, 'findByOrderItemId'>
  payments: PaymentService
  webhookSecret: string
}

/**
 * Paie une part sans opérateur, pour développer et démontrer le produit de bout en bout. Il ne
 * contourne rien : il envoie au service un webhook signé, exactement comme le ferait l'opérateur,
 * donc les mêmes règles s'appliquent (lien fermé, paiement déjà traité, montant).
 */
export function createPaymentSimulator(deps: PaymentSimulatorDeps) {
  const { store, payments, webhookSecret } = deps

  return {
    async simulate(orderItemId: string, status: 'CONFIRMED' | 'FAILED'): Promise<PaymentOutcome> {
      const payment = await store.findByOrderItemId(orderItemId)
      if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Paiement introuvable')

      const rawBody = JSON.stringify({
        reference: payment.id,
        providerTransactionId: `simulated_${payment.id}`,
        amount: payment.amount,
        status,
      })
      return payments.handleWebhook({
        rawBody,
        headers: { [SIGNATURE_HEADER]: signPayload(webhookSecret, rawBody) },
      })
    },
  }
}

export type PaymentSimulator = ReturnType<typeof createPaymentSimulator>
