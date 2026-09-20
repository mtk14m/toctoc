import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { TEST_WEBHOOK_SECRET, createTestDeps } from '../helpers/fakes.js'

const HOUR = 60 * 60 * 1000

describe('simulateur de paiement (HTTP)', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>

  const build = async (env: Record<string, string>) => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(loadConfig({ PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET, ...env }), deps)

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
  }

  const join = async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/group-orders/lien-de-test/items',
      payload: { menuItemId: 'menu_riz', quantity: 1, phone: '622 00 00 01', name: 'Aïcha' },
    })
    return res.json().data.orderItem.id as string
  }

  const simulate = (orderItemId: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/dev/order-items/${orderItemId}/payment`,
      ...(payload && { payload }),
    })

  const participants = async () =>
    (await app.inject({ method: 'GET', url: '/group-orders/lien-de-test' })).json().data.groupOrder
      .participants

  afterAll(async () => {
    await app.close()
  })

  describe('activé (ENABLE_PAYMENT_SIMULATOR=true)', () => {
    beforeEach(() => build({ NODE_ENV: 'development', ENABLE_PAYMENT_SIMULATOR: 'true' }))

    it('paie par défaut : la personne apparaît sur la liste du groupe', async () => {
      const id = await join()

      const res = await simulate(id)

      expect(res.statusCode).toBe(200)
      expect(res.json().data).toEqual({ outcome: 'confirmed' })
      expect(await participants()).toEqual([
        { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
      ])
    })

    it('simule aussi un échec', async () => {
      const id = await join()

      const res = await simulate(id, { outcome: 'FAILED' })

      expect(res.json().data).toEqual({ outcome: 'failed' })
      expect(await participants()).toEqual([])
    })

    it('refuse un résultat inconnu (400) et une part sans paiement (404)', async () => {
      const id = await join()

      const invalid = await simulate(id, { outcome: 'PEUT-ETRE' })
      const unknown = await simulate('inconnue')

      expect(invalid.statusCode).toBe(400)
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json().error.code).toBe('PAYMENT_NOT_FOUND')
    })
  })

  describe('désactivé (par défaut)', () => {
    it('n’existe pas : 404, même hors production', async () => {
      await build({ NODE_ENV: 'development' })
      const id = await join()

      expect((await simulate(id)).statusCode).toBe(404)
      expect(deps.paymentStore.payments[0]!.status).toBe('PENDING')
    })
  })
})
