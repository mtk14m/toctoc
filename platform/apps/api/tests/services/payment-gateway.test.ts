import { describe, expect, it } from 'vitest'
import { FakePaymentGateway, signPayload } from '../../src/services/payment-gateway.js'

const SECRET = 'secret-de-webhook-de-test-32-caracteres'

const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    reference: 'pay_1',
    providerTransactionId: 'tx_1',
    amount: 31000,
    status: 'CONFIRMED',
    ...overrides,
  })

describe('FakePaymentGateway.parseWebhook', () => {
  const gateway = new FakePaymentGateway({ webhookSecret: SECRET })
  const parse = (rawBody: string, signature: string | undefined) =>
    gateway.parseWebhook({
      rawBody,
      headers: signature === undefined ? {} : { 'x-toctoc-signature': signature },
    })

  it('accepte un évènement correctement signé', () => {
    const raw = body()

    expect(parse(raw, signPayload(SECRET, raw))).toEqual({
      reference: 'pay_1',
      providerTransactionId: 'tx_1',
      amount: 31000,
      status: 'CONFIRMED',
    })
  })

  it('accepte aussi un échec de paiement', () => {
    const raw = body({ status: 'FAILED' })

    expect(parse(raw, signPayload(SECRET, raw)).status).toBe('FAILED')
  })

  it.each([
    ['sans signature', undefined],
    ['avec une signature vide', ''],
    ['avec une signature fausse', 'abc123'],
    ['signé avec un autre secret', signPayload('un-autre-secret-de-32-caracteres-ok', body())],
  ])('refuse un évènement %s (401 INVALID_SIGNATURE)', (_label, signature) => {
    expect(() => parse(body(), signature)).toThrowError(
      expect.objectContaining({ statusCode: 401, code: 'INVALID_SIGNATURE' }),
    )
  })

  it('refuse un corps modifié après signature (le montant ne doit pas pouvoir être changé)', () => {
    const signature = signPayload(SECRET, body())

    expect(() => parse(body({ amount: 1 }), signature)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
    )
  })

  it('refuse un corps signé mais qui n’est pas du JSON (400 BAD_REQUEST)', () => {
    const raw = 'pas du json'

    expect(() => parse(raw, signPayload(SECRET, raw))).toThrowError(
      expect.objectContaining({ statusCode: 400, code: 'BAD_REQUEST' }),
    )
  })

  it.each([
    ['un statut inconnu', { status: 'REFUNDED' }],
    ['un montant décimal', { amount: 12.5 }],
    ['sans référence', { reference: undefined }],
  ])('refuse un évènement signé avec %s', (_label, override) => {
    const raw = body(override)

    expect(() => parse(raw, signPayload(SECRET, raw))).toThrow()
  })
})

describe('FakePaymentGateway.initiate', () => {
  it('accepte l’initiation (aucun opérateur réel derrière)', async () => {
    const gateway = new FakePaymentGateway({ webhookSecret: SECRET })

    await expect(
      gateway.initiate({
        reference: 'pay_1',
        amount: 31000,
        currency: 'GNF',
        phone: '+224622000001',
      }),
    ).resolves.toBeUndefined()
  })
})
