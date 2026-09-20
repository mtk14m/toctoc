import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })

describe('notation et remboursements (HTTP)', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let adminToken: string
  let clientToken: string
  let items: { aicha: string; mamadou: string }

  const rate = (orderItemId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/order-items/${orderItemId}/rating`, payload })

  const asAdmin = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url,
      ...(payload && { payload }),
      headers: { authorization: `Bearer ${adminToken}` },
    })

  const addItem = async (name: string, phone: string, status: 'CONFIRMED' | 'CANCELLED') => {
    const user = await deps.userStore.create({ phone, name })
    const id = `item_${deps.groupOrderStore.orderItems.length + 1}`
    deps.groupOrderStore.orderItems.push({
      id,
      groupOrderId: 'group_1',
      userId: user.id,
      participantName: name,
      menuItemName: 'Riz gras',
      quantity: 1,
      status,
    })
    return id
  }

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, deps)

    const ops = await deps.userStore.create({ phone: '+224620000000', name: 'Ops TocToc' })
    ops.role = 'ADMIN_PLATFORM'
    adminToken = app.jwt.sign({ sub: ops.id, role: ops.role })
    const client = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou C.' })
    clientToken = app.jwt.sign({ sub: client.id, role: client.role })

    deps.groupOrderStore.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    deps.groupOrderStore.groupOrders.push({
      id: 'group_1',
      creatorId: client.id,
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: new Date('2026-09-21T11:05:00.000Z'),
      paymentMode: 'SPLIT',
      status: 'DELIVERED',
    })
    items = {
      aicha: await addItem('Aïcha', '+224622000001', 'CONFIRMED'),
      mamadou: await addItem('Mamadou', '+224622000002', 'CONFIRMED'),
    }
  })

  afterAll(async () => {
    await app.close()
  })

  describe('POST /order-items/:id/rating', () => {
    it('est public : aucun jeton, le numéro de la part suffit (201)', async () => {
      const res = await rate(items.aicha, { phone: '622 00 00 01', score: 5 })

      expect(res.statusCode).toBe(201)
      expect(res.json().data.rating).toEqual({ score: 5, summary: { average: 5, count: 1 } })
    })

    it.each([
      ['une note à 0', { score: 0 }],
      ['une note à 6', { score: 6 }],
      ['une note décimale', { score: 4.5 }],
      ['une note en texte', { score: '5' }],
      ['sans note', { score: undefined }],
      ['sans numéro', { phone: undefined }],
    ])('refuse %s (400 VALIDATION_ERROR)', async (_label, override) => {
      const res = await rate(items.aicha, { phone: '622000001', score: 5, ...override })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('refuse le numéro d’un autre (404), et une deuxième note (409)', async () => {
      const stranger = await rate(items.aicha, { phone: '622000002', score: 1 })
      await rate(items.aicha, { phone: '622000001', score: 5 })
      const twice = await rate(items.aicha, { phone: '622000001', score: 1 })

      expect(stranger.statusCode).toBe(404)
      expect(twice.statusCode).toBe(409)
      expect(twice.json().error.code).toBe('ALREADY_RATED')
    })

    it('refuse tant que la commande n’est pas livrée (409 NOT_DELIVERED_YET)', async () => {
      deps.groupOrderStore.groupOrders[0]!.status = 'IN_DELIVERY'

      const res = await rate(items.aicha, { phone: '622000001', score: 5 })

      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('NOT_DELIVERED_YET')
    })

    it('apparaît ensuite sur la page de la commande, la moyenne du jour pour le groupe', async () => {
      await rate(items.aicha, { phone: '622000001', score: 5 })
      await rate(items.mamadou, { phone: '622000002', score: 4 })

      const page = (await app.inject({ method: 'GET', url: '/group-orders/lien' })).json().data
        .groupOrder

      expect(page.rating).toEqual({ average: 4.5, count: 2 })
    })

    it('la page ne montre aucune note tant que personne n’a noté', async () => {
      const page = (await app.inject({ method: 'GET', url: '/group-orders/lien' })).json().data
        .groupOrder

      expect(page.rating).toBeNull()
    })

    it('alimente la note du restaurant dans l’annuaire public', async () => {
      const created = await asAdmin('POST', '/admin/partners', {
        name: 'Chez Aïssatou',
        type: 'CUISINE_MAISON',
        phone: '622000000',
        address: 'Almamya',
        city: 'Conakry',
      })
      expect(created.json().data.partner.id).toBe('partner_1') // même id que celui de la commande
      await rate(items.aicha, { phone: '622000001', score: 5 })
      await rate(items.mamadou, { phone: '622000002', score: 4 })

      const list = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(list.json().data.restaurants[0].rating).toEqual({ average: 4.5, count: 2 })
    })
  })

  describe('les remboursements (équipe)', () => {
    let lateItem: string

    beforeEach(async () => {
      // Un débit arrivé après la fermeture : encaissé, mais la part est annulée.
      lateItem = await addItem('Fatou', '+224622000003', 'CANCELLED')
      const payment = deps.paymentStore.createPending(lateItem, 31000)
      payment.status = 'CONFIRMED'
      payment.providerTransactionId = 'tx_tardif'
      payment.paidAt = new Date('2026-09-21T10:25:00.000Z')
    })

    it('exigent un jeton (401) et le rôle ADMIN_PLATFORM (403)', async () => {
      expect((await app.inject({ method: 'GET', url: '/admin/refunds' })).statusCode).toBe(401)
      const asClient = await app.inject({
        method: 'GET',
        url: '/admin/refunds',
        headers: { authorization: `Bearer ${clientToken}` },
      })
      expect(asClient.statusCode).toBe(403)
    })

    it('listent ce qu’il reste à rembourser, avec le numéro de la personne', async () => {
      const res = await asAdmin('GET', '/admin/refunds')

      expect(res.statusCode).toBe(200)
      expect(res.json().data.refunds).toEqual([
        expect.objectContaining({
          orderItemId: lateItem,
          amount: 31000,
          currency: 'GNF',
          providerTransactionId: 'tx_tardif',
          restaurantName: 'Chez Aïssatou',
          participant: { name: 'Fatou', phone: '+224622000003' },
        }),
      ])
    })

    it('enregistrent un remboursement avec sa référence, puis le retirent de la liste', async () => {
      const done = await asAdmin('POST', `/admin/refunds/${lateItem}/refunded`, {
        reference: 'OM-2026-0921-77',
      })
      const list = await asAdmin('GET', '/admin/refunds')

      expect(done.statusCode).toBe(200)
      expect(done.json().data.refund).toEqual({ orderItemId: lateItem, refunded: true })
      expect(list.json().data.refunds).toEqual([])
      expect(deps.refundStore.auditLogs.map((log) => log.action)).toEqual(['order_item.refunded'])
    })

    it('refusent une référence vide ou trop courte (400), un double remboursement (409)', async () => {
      const short = await asAdmin('POST', `/admin/refunds/${lateItem}/refunded`, { reference: 'x' })
      await asAdmin('POST', `/admin/refunds/${lateItem}/refunded`, { reference: 'OM-1' })
      const twice = await asAdmin('POST', `/admin/refunds/${lateItem}/refunded`, {
        reference: 'OM-2',
      })

      expect(short.statusCode).toBe(400)
      expect(twice.statusCode).toBe(409)
      expect(twice.json().error.code).toBe('ALREADY_REFUNDED')
    })

    it('refusent une part qui n’est pas à rembourser (409) ou inconnue (404)', async () => {
      const delivered = await asAdmin('POST', `/admin/refunds/${items.aicha}/refunded`, {
        reference: 'OM-1',
      })
      const unknown = await asAdmin('POST', '/admin/refunds/inconnue/refunded', {
        reference: 'OM-1',
      })

      expect(delivered.statusCode).toBe(409)
      expect(delivered.json().error.code).toBe('NOT_REFUNDABLE')
      expect(unknown.statusCode).toBe(404)
    })
  })
})
