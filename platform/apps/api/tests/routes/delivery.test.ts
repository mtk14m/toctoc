import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })

describe('livraison (HTTP) — de l’assignation au code de confirmation', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let adminToken: string
  let clientToken: string
  let driverToken: string
  let driver: { id: string; userId: string }

  const call = (
    method: 'GET' | 'POST',
    url: string,
    token: string | null,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      ...(payload && { payload }),
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
    })

  const publicOrder = async () =>
    (await app.inject({ method: 'GET', url: '/group-orders/lien' })).json().data.groupOrder

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, deps)

    const ops = await deps.userStore.create({ phone: '+224620000000', name: 'Ops TocToc' })
    ops.role = 'ADMIN_PLATFORM'
    adminToken = app.jwt.sign({ sub: ops.id, role: ops.role })
    const client = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    clientToken = app.jwt.sign({ sub: client.id, role: client.role })

    // Une commande fermée, avec trois plats payés et un annulé.
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
      deliveryAddress: 'Kaloum Center, 3e étage',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: new Date('2026-09-21T11:05:00.000Z'),
      paymentMode: 'SPLIT',
      status: 'CLOSED',
    })
    for (const [dish, status] of [
      ['Riz gras', 'CONFIRMED'],
      ['Riz gras', 'CONFIRMED'],
      ['Attiéké poisson', 'CONFIRMED'],
      ['Riz gras', 'CANCELLED'],
    ] as const) {
      deps.groupOrderStore.orderItems.push({
        id: `item_${deps.groupOrderStore.orderItems.length + 1}`,
        groupOrderId: 'group_1',
        participantName: 'Participant',
        menuItemName: dish,
        quantity: 1,
        status,
      })
    }

    const created = await call('POST', '/admin/drivers', adminToken, {
      phone: '623 00 00 00',
      name: 'Ibrahima',
    })
    driver = created.json().data.driver
    driverToken = app.jwt.sign({ sub: driver.userId, role: 'DRIVER' })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('les livreurs (équipe)', () => {
    it('exigent un jeton (401) et le rôle ADMIN_PLATFORM (403)', async () => {
      expect((await call('GET', '/admin/drivers', null)).statusCode).toBe(401)
      expect((await call('GET', '/admin/drivers', clientToken)).statusCode).toBe(403)
      expect((await call('GET', '/admin/drivers', driverToken)).statusCode).toBe(403)
    })

    it('POST crée un livreur (201) et GET les liste', async () => {
      const list = await call('GET', '/admin/drivers', adminToken)

      expect(list.json().data.drivers).toEqual([
        {
          id: driver.id,
          userId: driver.userId,
          name: 'Ibrahima',
          phone: '+224623000000',
          active: true,
        },
      ])
    })

    it('refuse un numéro invalide (400) ou celui de l’équipe (409)', async () => {
      const invalid = await call('POST', '/admin/drivers', adminToken, { phone: '12', name: 'X' })
      const teamPhone = await call('POST', '/admin/drivers', adminToken, {
        phone: '620000000',
        name: 'Ops',
      })

      expect(invalid.json().error.code).toBe('INVALID_PHONE')
      expect(teamPhone.statusCode).toBe(409)
      expect(teamPhone.json().error.code).toBe('PHONE_IN_USE')
    })
  })

  describe('la vue de l’équipe : les commandes à traiter', () => {
    it('liste par défaut les commandes fermées et en route, avec leur récap', async () => {
      const res = await call('GET', '/admin/group-orders', adminToken)

      expect(res.statusCode).toBe(200)
      expect(res.json().data.orders).toEqual([
        expect.objectContaining({
          id: 'group_1',
          status: 'CLOSED',
          restaurantName: 'Chez Aïssatou',
          totalDishes: 3,
          dishes: [
            { dish: 'Riz gras', quantity: 2 },
            { dish: 'Attiéké poisson', quantity: 1 },
          ],
          delivery: null,
        }),
      ])
    })

    it('filtre par statut, et refuse un statut inconnu (400)', async () => {
      const delivered = await call('GET', '/admin/group-orders?status=DELIVERED', adminToken)
      const unknown = await call('GET', '/admin/group-orders?status=PIZZA', adminToken)

      expect(delivered.json().data.orders).toEqual([])
      expect(unknown.statusCode).toBe(400)
      expect(unknown.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('exige le rôle ADMIN_PLATFORM', async () => {
      expect((await call('GET', '/admin/group-orders', clientToken)).statusCode).toBe(403)
    })
  })

  describe('le parcours complet', () => {
    const assign = () =>
      call('POST', '/admin/group-orders/group_1/delivery', adminToken, { driverId: driver.id })

    it('assigner → récupérer (le code apparaît sur la page du groupe) → confirmer', async () => {
      // 1. l'équipe assigne
      const assigned = await assign()
      expect(assigned.statusCode).toBe(201)
      const { deliveryId } = assigned.json().data.delivery

      // le groupe ne voit encore aucun code
      expect((await publicOrder()).delivery).toEqual({ status: 'ASSIGNED', confirmationCode: null })

      // 2. le livreur voit sa tournée, sans contact ni code
      const tour = await call('GET', '/driver/deliveries', driverToken)
      expect(tour.json().data.deliveries).toEqual([
        expect.objectContaining({
          id: deliveryId,
          status: 'ASSIGNED',
          totalDishes: 3,
          contact: null,
          restaurant: { name: 'Chez Aïssatou', address: 'Almamya', phone: '+224622000000' },
        }),
      ])

      // 3. il récupère les plats : il reçoit le contact, le groupe reçoit le code
      const pickedUp = await call('POST', `/driver/deliveries/${deliveryId}/picked-up`, driverToken)
      expect(pickedUp.statusCode).toBe(200)
      expect(pickedUp.json().data.delivery).toMatchObject({
        status: 'PICKED_UP',
        contact: { name: 'Mamadou', phone: '+224621000000' },
      })
      const page = await publicOrder()
      expect(page.status).toBe('IN_DELIVERY')
      const code = page.delivery.confirmationCode as string
      expect(code).toMatch(/^\d{4}$/)
      expect(pickedUp.body).not.toContain(code) // le livreur ne voit jamais le code

      // 4. le livreur saisit le code que le groupe lui donne
      const confirmed = await call(
        'POST',
        `/driver/deliveries/${deliveryId}/confirm`,
        driverToken,
        {
          code,
        },
      )
      expect(confirmed.statusCode).toBe(200)
      expect(confirmed.json().data).toEqual({ status: 'DELIVERED' })

      // la commande est livrée, et le code n'est plus affiché
      const done = await publicOrder()
      expect(done.status).toBe('DELIVERED')
      expect(done.delivery).toEqual({ status: 'DELIVERED', confirmationCode: null })
    })

    it('un mauvais code est refusé avec le nombre d’essais restants, puis bloque à 5', async () => {
      const { deliveryId } = (await assign()).json().data.delivery
      await call('POST', `/driver/deliveries/${deliveryId}/picked-up`, driverToken)
      const wrong = (code: string) =>
        call('POST', `/driver/deliveries/${deliveryId}/confirm`, driverToken, { code })
      const realCode = (await publicOrder()).delivery.confirmationCode as string
      const notTheCode = realCode === '0000' ? '1111' : '0000'

      const first = await wrong(notTheCode)
      expect(first.statusCode).toBe(401)
      expect(first.json().error).toMatchObject({
        code: 'INVALID_CONFIRMATION_CODE',
        details: { attemptsLeft: 4 },
      })

      for (let i = 0; i < 3; i++) await wrong(notTheCode)
      const fifth = await wrong(notTheCode)
      expect(fifth.statusCode).toBe(429)
      expect((await wrong(realCode)).statusCode).toBe(429) // verrouillé, même avec le bon code
      expect((await publicOrder()).status).toBe('IN_DELIVERY')
    })

    it('l’équipe peut confirmer à la place (override), avec une raison, et c’est tracé', async () => {
      const { deliveryId } = (await assign()).json().data.delivery
      await call('POST', `/driver/deliveries/${deliveryId}/picked-up`, driverToken)

      const short = await call('POST', `/admin/deliveries/${deliveryId}/override`, adminToken, {
        reason: 'ok',
      })
      const overridden = await call(
        'POST',
        `/admin/deliveries/${deliveryId}/override`,
        adminToken,
        {
          reason: 'Le relais est injoignable, confirmé par téléphone',
        },
      )

      expect(short.statusCode).toBe(400) // une vraie raison, pas « ok »
      expect(overridden.statusCode).toBe(200)
      expect(overridden.json().data.delivery).toEqual({
        status: 'DELIVERED',
        deliveredByOverride: true,
      })
      expect((await publicOrder()).status).toBe('DELIVERED')
      expect(deps.deliveryStore.auditLogs.map((log) => log.action)).toEqual([
        'delivery.driver_assigned',
        'delivery.manual_override',
      ])
    })

    it('refuse d’assigner une commande qui n’est pas fermée (409) ou un livreur inconnu (404)', async () => {
      deps.groupOrderStore.groupOrders[0]!.status = 'OPEN'

      const notReady = await assign()
      const noDriver = await call('POST', '/admin/group-orders/group_1/delivery', adminToken, {
        driverId: 'inconnu',
      })

      expect(notReady.statusCode).toBe(409)
      expect(notReady.json().error.code).toBe('GROUP_ORDER_NOT_READY')
      expect(noDriver.statusCode).toBe(404)
    })

    it('réassigner renvoie 200 (et non 201) tant que rien n’a été récupéré', async () => {
      await assign()
      const other = (
        await call('POST', '/admin/drivers', adminToken, { phone: '624 00 00 00', name: 'Sékou' })
      ).json().data.driver

      const res = await call('POST', '/admin/group-orders/group_1/delivery', adminToken, {
        driverId: other.id,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.delivery.reassigned).toBe(true)
    })
  })

  describe('l’espace livreur', () => {
    it('exige un jeton (401) et le rôle DRIVER (403) : ni un client ni l’équipe', async () => {
      expect((await call('GET', '/driver/deliveries', null)).statusCode).toBe(401)
      expect((await call('GET', '/driver/deliveries', clientToken)).statusCode).toBe(403)
      expect((await call('GET', '/driver/deliveries', adminToken)).statusCode).toBe(403)
    })

    it('un livreur désactivé est refusé', async () => {
      deps.deliveryStore.drivers[0]!.active = false

      expect((await call('GET', '/driver/deliveries', driverToken)).statusCode).toBe(403)
    })

    it('ne peut ni récupérer ni confirmer la livraison d’un autre (404)', async () => {
      const { deliveryId } = (
        await call('POST', '/admin/group-orders/group_1/delivery', adminToken, {
          driverId: driver.id,
        })
      ).json().data.delivery
      const other = (
        await call('POST', '/admin/drivers', adminToken, { phone: '624 00 00 00', name: 'Sékou' })
      ).json().data.driver
      const otherToken = app.jwt.sign({ sub: other.userId, role: 'DRIVER' })

      const pick = await call('POST', `/driver/deliveries/${deliveryId}/picked-up`, otherToken)
      const confirm = await call('POST', `/driver/deliveries/${deliveryId}/confirm`, otherToken, {
        code: '1234',
      })

      expect(pick.statusCode).toBe(404)
      expect(confirm.statusCode).toBe(404)
    })

    it.each([
      ['un code de 3 chiffres', '123'],
      ['un code de 5 chiffres', '12345'],
      ['un code avec des lettres', 'abcd'],
      ['un code vide', ''],
    ])('refuse %s (400 VALIDATION_ERROR)', async (_label, code) => {
      const { deliveryId } = (
        await call('POST', '/admin/group-orders/group_1/delivery', adminToken, {
          driverId: driver.id,
        })
      ).json().data.delivery

      const res = await call('POST', `/driver/deliveries/${deliveryId}/confirm`, driverToken, {
        code,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })
  })
})
