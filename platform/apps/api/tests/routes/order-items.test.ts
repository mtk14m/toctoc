import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const HOUR = 60 * 60 * 1000

describe('routes POST /group-orders/:shareToken/items', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>

  const validBody = () => ({
    menuItemId: 'menu_riz',
    quantity: 1,
    phone: '622 00 00 01',
    name: 'Aïcha',
  })

  const join = (payload: Record<string, unknown>, token = 'lien-de-test', headers = {}) =>
    app.inject({ method: 'POST', url: `/group-orders/${token}/items`, payload, headers })

  async function start(env: Record<string, string> = {}) {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(loadConfig({ NODE_ENV: 'test', ...env }), deps)

    // Les routes utilisent l'horloge réelle : les horaires sont donc relatifs à maintenant.
    const relais = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    const deliveryTime = new Date(Date.now() + 4 * HOUR)
    const deliveryDay = new Date(
      Date.UTC(
        deliveryTime.getUTCFullYear(),
        deliveryTime.getUTCMonth(),
        deliveryTime.getUTCDate(),
      ),
    )
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
      availableDate: deliveryDay,
      active: true,
    })
  }

  beforeEach(() => start())

  afterAll(async () => {
    await app.close()
  })

  it('crée la commande sans aucun jeton, avec le montant à payer (201)', async () => {
    const res = await join(validBody())

    expect(res.statusCode).toBe(201)
    expect(res.json().data.orderItem).toEqual({
      id: expect.any(String),
      status: 'PENDING_PAYMENT',
      dish: 'Riz gras',
      quantity: 1,
      unitPrice: 25000,
      deliveryFee: 6000,
      amount: 31000,
    })
  })

  it('utilise 1 comme quantité par défaut', async () => {
    const { quantity: _omitted, ...withoutQuantity } = validBody()

    const res = await join(withoutQuantity)

    expect(res.statusCode).toBe(201)
    expect(res.json().data.orderItem.quantity).toBe(1)
  })

  it.each([
    ['sans plat', { menuItemId: undefined }],
    ['sans téléphone', { phone: undefined }],
    ['sans nom', { name: undefined }],
    ['avec un nom vide', { name: '   ' }],
    ['avec une quantité nulle', { quantity: 0 }],
    ['avec une quantité décimale', { quantity: 1.5 }],
    ['avec trop de plats d’un coup', { quantity: 11 }],
  ])('refuse une commande %s (400 VALIDATION_ERROR)', async (_label, override) => {
    const res = await join({ ...validBody(), ...override })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
    const res = await join({ ...validBody(), phone: '12' })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_PHONE')
  })

  it('répond 404 pour un lien inconnu et pour un plat inconnu', async () => {
    const unknownLink = await join(validBody(), 'inconnu')
    const unknownDish = await join({ ...validBody(), menuItemId: 'inconnu' })

    expect(unknownLink.statusCode).toBe(404)
    expect(unknownLink.json().error.code).toBe('GROUP_ORDER_NOT_FOUND')
    expect(unknownDish.statusCode).toBe(404)
    expect(unknownDish.json().error.code).toBe('MENU_ITEM_NOT_FOUND')
  })

  it('répond 409 quand le numéro a déjà commandé, ou quand le lien est fermé', async () => {
    await join(validBody())
    const again = await join(validBody())
    deps.groupOrderStore.groupOrders[0]!.status = 'CLOSED'
    const closed = await join({ ...validBody(), phone: '622 00 00 02' })

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('ALREADY_JOINED')
    expect(closed.statusCode).toBe(409)
    expect(closed.json().error.code).toBe('GROUP_ORDER_CLOSED')
  })

  describe('cohérence avec la page publique du lien', () => {
    const publicParticipants = async () => {
      const res = await app.inject({ method: 'GET', url: '/group-orders/lien-de-test' })
      return res.json().data.groupOrder.participants
    }

    it('en SPLIT, une commande non payée n’apparaît pas encore dans la liste', async () => {
      await join(validBody())

      expect(await publicParticipants()).toEqual([])
    })

    it('en HOST_PAYS, elle apparaît en attente du règlement du créateur', async () => {
      deps.groupOrderStore.groupOrders[0]!.paymentMode = 'HOST_PAYS'
      await join(validBody())

      expect(await publicParticipants()).toEqual([
        { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: true },
      ])
    })
  })

  describe('IP du client pour la limite de débit', () => {
    const spoofed = { 'x-forwarded-for': '203.0.113.7' }

    it('ignore X-Forwarded-For sans proxy de confiance (l’en-tête est falsifiable)', async () => {
      await join(validBody(), 'lien-de-test', spoofed)

      const keys = (deps.rateLimiter as { keys: string[] }).keys
      expect(keys).toContain('join:ip:127.0.0.1')
      expect(keys).not.toContain('join:ip:203.0.113.7')
    })

    it('lit l’IP du client dans X-Forwarded-For derrière un proxy de confiance (Caddy)', async () => {
      await start({ TRUST_PROXY: 'true' })

      await join(validBody(), 'lien-de-test', spoofed)

      const keys = (deps.rateLimiter as { keys: string[] }).keys
      expect(keys).toContain('join:ip:203.0.113.7')
    })
  })
})
