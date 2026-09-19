import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { signPayload } from '../../src/services/payment-gateway.js'
import { TEST_WEBHOOK_SECRET, createTestDeps } from '../helpers/fakes.js'

const HOUR = 60 * 60 * 1000

describe('paiement de bout en bout (HTTP)', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>

  const join = (phone = '622 00 00 01', name = 'Aïcha') =>
    app.inject({
      method: 'POST',
      url: '/group-orders/lien-de-test/items',
      payload: { menuItemId: 'menu_riz', quantity: 1, phone, name },
    })

  const webhook = (
    body: Record<string, unknown>,
    signature: string | null = null,
    secret = TEST_WEBHOOK_SECRET,
  ) => {
    const rawBody = JSON.stringify(body)
    return app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      payload: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-toctoc-signature': signature ?? signPayload(secret, rawBody),
      },
    })
  }

  const pendingEvent = (overrides: Record<string, unknown> = {}) => ({
    reference: deps.paymentStore.payments[0]!.id,
    providerTransactionId: 'tx_operateur_1',
    amount: 31000,
    status: 'CONFIRMED',
    ...overrides,
  })

  const publicParticipants = async () => {
    const res = await app.inject({ method: 'GET', url: '/group-orders/lien-de-test' })
    return res.json().data.groupOrder.participants
  }

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(loadConfig({ NODE_ENV: 'test' }), deps)

    // Les routes utilisent l'horloge réelle : les horaires sont donc relatifs à maintenant.
    const relais = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    const deliveryTime = new Date(Date.now() + 4 * HOUR)
    deps.groupOrderStore.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    deps.groupOrderStore.groupOrders.push({
      id: 'group_1',
      creatorId: relais.id,
      partnerId: 'partner_1',
      shareToken: 'lien-de-test',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: new Date(Date.now() + 2 * HOUR),
      deliveryTime,
      paymentMode: 'SPLIT',
      status: 'OPEN',
    })
    deps.groupOrderStore.menuItems.push({
      id: 'menu_riz',
      partnerId: 'partner_1',
      name: 'Riz gras',
      description: null,
      price: 25000,
      photoUrl: null,
      availableDate: new Date(
        Date.UTC(
          deliveryTime.getUTCFullYear(),
          deliveryTime.getUTCMonth(),
          deliveryTime.getUTCDate(),
        ),
      ),
      active: true,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejoindre lance le paiement : la réponse annonce un paiement en attente', async () => {
    const res = await join()

    expect(res.statusCode).toBe(201)
    expect(res.json().data.orderItem).toMatchObject({
      status: 'PENDING_PAYMENT',
      amount: 31000,
      payment: { status: 'PENDING' },
    })
    expect(deps.paymentGateway.initiated).toEqual([
      expect.objectContaining({ amount: 31000, currency: 'GNF', phone: '+224622000001' }),
    ])
  })

  it('le webhook confirmé fait apparaître la personne sur la liste du groupe (le waouh n°1)', async () => {
    await join()
    expect(await publicParticipants()).toEqual([]) // pas payé : pas encore sur la liste

    const res = await webhook(pendingEvent())

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: { received: true } })
    expect(await publicParticipants()).toEqual([
      { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
    ])
  })

  it('accepte le même évènement deux fois (l’opérateur réessaie) sans rien changer', async () => {
    await join()
    await webhook(pendingEvent())

    const again = await webhook(pendingEvent())

    expect(again.statusCode).toBe(200)
    expect(await publicParticipants()).toHaveLength(1)
  })

  it('un échec de paiement annule la commande : la personne n’apparaît jamais et peut réessayer', async () => {
    await join()

    const res = await webhook(pendingEvent({ status: 'FAILED' }))

    expect(res.statusCode).toBe(200)
    expect(await publicParticipants()).toEqual([])
    expect((await join()).statusCode).toBe(201)
  })

  it('refuse un évènement mal signé (401) sans rien changer : c’est la seule protection de l’endpoint', async () => {
    await join()

    const wrongSecret = await webhook(pendingEvent(), null, 'un-autre-secret-de-32-caracteres-ok')
    const wrongSignature = await webhook(pendingEvent(), 'abc123')

    expect(wrongSecret.statusCode).toBe(401)
    expect(wrongSecret.json().error.code).toBe('INVALID_SIGNATURE')
    expect(wrongSignature.statusCode).toBe(401)
    expect(await publicParticipants()).toEqual([])
    expect(deps.paymentStore.payments[0]!.status).toBe('PENDING')
  })

  it('refuse un montant qui ne correspond pas (422)', async () => {
    await join()

    const res = await webhook(pendingEvent({ amount: 1000 }))

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('AMOUNT_MISMATCH')
    expect(await publicParticipants()).toEqual([])
  })

  it('répond 404 pour une référence inconnue', async () => {
    await join()

    const res = await webhook(pendingEvent({ reference: 'inconnue' }))

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('PAYMENT_NOT_FOUND')
  })

  it('répond 502 si l’opérateur est injoignable, sans exposer la cause, et la personne peut réessayer', async () => {
    deps.paymentGateway.failWith = new Error('secret interne de l’opérateur')

    const res = await join()

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('PAYMENT_UNAVAILABLE')
    expect(res.body).not.toContain('secret interne')

    deps.paymentGateway.failWith = null
    expect((await join()).statusCode).toBe(201)
  })
})
