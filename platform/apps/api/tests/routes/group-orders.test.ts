import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })
// Lundi 21 septembre 2026, 10h00 à Conakry : la commande reste ouverte 20 minutes (jusqu'à 10h20),
// la livraison est estimée 45 minutes plus tard (11h05).
const NOW = new Date('2026-09-21T10:00:00.000Z')

describe('routes /group-orders', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let clock: Date
  let token: string

  const validBody = () => ({
    partnerId: 'partner_1',
    deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
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
    clock = NOW
    deps = createTestDeps()
    app = await buildApp(config, { ...deps, now: () => clock })
    const relais = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    token = app.jwt.sign({ sub: relais.id, role: 'CLIENT' })
    deps.groupOrderStore.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    deps.groupOrderStore.menuItems.push({
      id: 'menu_riz',
      partnerId: 'partner_1',
      name: 'Riz gras',
      description: null,
      price: 25000,
      photoUrl: null,
      availableDate: new Date('2026-09-21'),
      active: true,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('POST /group-orders — commencer une commande', () => {
    it('crée la commande et renvoie son jeton de partage, avec l’heure de fermeture et de livraison (201)', async () => {
      const res = await create(validBody())

      expect(res.statusCode).toBe(201)
      expect(res.json().data.groupOrder).toEqual({
        id: expect.any(String),
        shareToken: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
        status: 'OPEN',
        paymentMode: 'SPLIT',
        deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
        orderCutoffTime: '2026-09-21T10:20:00.000Z',
        deliveryTime: '2026-09-21T11:05:00.000Z',
      })
    })

    it('ignore les heures envoyées par le client : la fenêtre de 20 minutes n’est pas négociable', async () => {
      const res = await create({
        ...validBody(),
        orderCutoffTime: '2026-09-21T23:00:00.000Z',
        deliveryTime: '2026-09-21T23:30:00.000Z',
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().data.groupOrder.orderCutoffTime).toBe('2026-09-21T10:20:00.000Z')
    })

    describe('sans compte : téléphone et nom suffisent, comme pour rejoindre', () => {
      it('crée la commande et le compte, sans aucun jeton (201)', async () => {
        const res = await create({ ...validBody(), phone: '622 00 00 01', name: 'Aïcha' }, null)

        expect(res.statusCode).toBe(201)
        expect(res.json().data.groupOrder.shareToken).toEqual(expect.any(String))
        expect(deps.userStore.users.find((u) => u.phone === '+224622000001')).toMatchObject({
          name: 'Aïcha',
        })
      })

      it.each([
        ['sans téléphone', { name: 'Aïcha' }],
        ['sans nom', { phone: '622 00 00 01' }],
        ['sans rien', {}],
      ])('refuse une demande %s (400 VALIDATION_ERROR)', async (_label, identity) => {
        const res = await create({ ...validBody(), ...identity }, null)

        expect(res.statusCode).toBe(400)
        expect(res.json().error.code).toBe('VALIDATION_ERROR')
      })

      it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
        const res = await create({ ...validBody(), phone: '12', name: 'Aïcha' }, null)

        expect(res.statusCode).toBe(400)
        expect(res.json().error.code).toBe('INVALID_PHONE')
      })
    })

    it('refuse un jeton invalide au lieu de l’ignorer (401 UNAUTHORIZED)', async () => {
      const res = await create(
        { ...validBody(), phone: '622 00 00 01', name: 'Aïcha' },
        'pas.un.jeton',
      )

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it.each([
      ['sans restaurant', { partnerId: undefined }],
      ['sans adresse', { deliveryAddress: '   ' }],
      ['avec un mode de paiement inconnu', { paymentMode: 'CASH' }],
      ['avec une latitude hors limites', { deliveryLat: 123 }],
    ])('refuse un corps %s (400 VALIDATION_ERROR)', async (_label, override) => {
      const res = await create({ ...validBody(), ...override })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('répond 404 pour un restaurant inconnu', async () => {
      const res = await create({ ...validBody(), partnerId: 'inconnu' })

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('PARTNER_NOT_FOUND')
    })

    it('refuse le mode « j’invite tout le monde » tant qu’il n’est pas disponible (422)', async () => {
      const res = await create({ ...validBody(), paymentMode: 'HOST_PAYS' })

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('PAYMENT_MODE_UNAVAILABLE')
    })

    it('refuse avant l’ouverture du service, à 9h (422 SERVICE_NOT_OPEN)', async () => {
      clock = new Date('2026-09-21T08:30:00.000Z')

      const res = await create(validBody())

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('SERVICE_NOT_OPEN')
    })

    it('refuse quand la livraison dépasserait minuit (422 TOO_LATE_TO_DELIVER)', async () => {
      clock = new Date('2026-09-21T23:00:00.000Z')

      const res = await create(validBody())

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('TOO_LATE_TO_DELIVER')
    })

    it('refuse un restaurant sans menu ce jour-là (422 NO_MENU_FOR_DATE)', async () => {
      deps.groupOrderStore.menuItems.length = 0

      const res = await create(validBody())

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('NO_MENU_FOR_DATE')
    })
  })

  describe('GET /group-orders/:shareToken', () => {
    async function createLink() {
      const res = await create(validBody())
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
        participants: [],
      })
      expect(res.json().data.groupOrder.menu.map((m: { name: string }) => m.name)).toEqual([
        'Riz gras',
      ])
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
