import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })
const HOUR = 60 * 60 * 1000

describe('routes /group-orders', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let token: string

  // Les routes utilisent l'horloge réelle : les horaires sont donc relatifs à maintenant.
  const validBody = () => ({
    partnerId: 'partner_1',
    deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
    orderCutoffTime: new Date(Date.now() + 2 * HOUR).toISOString(),
    deliveryTime: new Date(Date.now() + 4 * HOUR).toISOString(),
  })

  const create = (payload: Record<string, unknown>, authorization: string | null = token) =>
    app.inject({
      method: 'POST',
      url: '/group-orders',
      payload,
      ...(authorization && { headers: { authorization: `Bearer ${authorization}` } }),
    })

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, deps)
    const relais = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    token = app.jwt.sign({ sub: relais.id, role: 'CLIENT' })
    deps.groupOrderStore.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('POST /group-orders', () => {
    it('crée le lien et renvoie son jeton de partage (201)', async () => {
      const res = await create(validBody())

      expect(res.statusCode).toBe(201)
      const { data } = res.json()
      expect(data.groupOrder).toMatchObject({
        id: expect.any(String),
        shareToken: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
        status: 'OPEN',
        paymentMode: 'SPLIT',
        deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
      })
    })

    it('accepte le mode HOST_PAYS', async () => {
      const res = await create({ ...validBody(), paymentMode: 'HOST_PAYS' })

      expect(res.statusCode).toBe(201)
      expect(res.json().data.groupOrder.paymentMode).toBe('HOST_PAYS')
    })

    it('exige un jeton (401 UNAUTHORIZED)', async () => {
      const res = await create(validBody(), null)

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it.each([
      ['sans partenaire', { partnerId: undefined }],
      ['sans adresse', { deliveryAddress: '   ' }],
      ['avec une heure qui n’est pas ISO', { orderCutoffTime: 'demain 10h' }],
      ['avec un mode de paiement inconnu', { paymentMode: 'CASH' }],
      ['avec une latitude hors limites', { deliveryLat: 123 }],
    ])('refuse un corps %s (400 VALIDATION_ERROR)', async (_label, override) => {
      const res = await create({ ...validBody(), ...override })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('répond 404 pour un partenaire inconnu', async () => {
      const res = await create({ ...validBody(), partnerId: 'inconnu' })

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('PARTNER_NOT_FOUND')
    })

    it('répond 422 pour une heure limite passée', async () => {
      const res = await create({
        ...validBody(),
        orderCutoffTime: new Date(Date.now() - HOUR).toISOString(),
      })

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('CUTOFF_IN_PAST')
    })
  })

  describe('GET /group-orders/:shareToken', () => {
    async function createLink(mode: 'SPLIT' | 'HOST_PAYS' = 'SPLIT') {
      const res = await create({ ...validBody(), paymentMode: mode })
      return res.json().data.groupOrder as { id: string; shareToken: string }
    }

    it('est public : aucun jeton requis', async () => {
      const { shareToken } = await createLink()

      const res = await app.inject({ method: 'GET', url: `/group-orders/${shareToken}` })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.groupOrder).toMatchObject({
        status: 'OPEN',
        creatorName: 'Mamadou',
        partner: { name: 'Chez Aïssatou', type: 'CUISINE_MAISON' },
        menu: [],
        participants: [],
      })
    })

    it('répond 404 GROUP_ORDER_NOT_FOUND pour un jeton inconnu', async () => {
      const res = await app.inject({ method: 'GET', url: '/group-orders/inconnu' })

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('GROUP_ORDER_NOT_FOUND')
    })

    it('n’expose ni numéro de téléphone ni identifiant interne', async () => {
      const { id, shareToken } = await createLink()
      deps.groupOrderStore.orderItems.push({
        id: 'item_secret',
        groupOrderId: id,
        participantName: 'Aïcha',
        menuItemName: 'Riz gras',
        quantity: 1,
        status: 'CONFIRMED',
      })

      const res = await app.inject({ method: 'GET', url: `/group-orders/${shareToken}` })

      expect(res.body).not.toContain('+224')
      expect(res.body).not.toContain('item_secret')
      expect(res.body).not.toContain('partner_1')
      expect(res.json().data.groupOrder.participants).toEqual([
        { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
      ])
    })
  })
})
