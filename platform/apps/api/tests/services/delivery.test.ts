import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CONFIRMATION_ATTEMPTS, createDeliveryService } from '../../src/services/delivery.js'
import {
  InMemoryDeliveryStore,
  InMemoryGroupOrderStore,
  InMemoryUserStore,
  RecordingPublisher,
} from '../helpers/fakes.js'

// Lundi 21 septembre 2026. La commande s'est fermée à 10h20 ; la livraison est estimée à 11h05.
const NOW = new Date('2026-09-21T10:30:00.000Z')
const DELIVERY_TIME = new Date('2026-09-21T11:05:00.000Z')
const OPS = 'admin_1'

describe('DeliveryService', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let store: InMemoryDeliveryStore
  let publisher: RecordingPublisher
  let delivery: ReturnType<typeof createDeliveryService>
  let current: Date
  let driver: { id: string; userId: string }
  let otherDriver: { id: string; userId: string }

  const orderStatus = () => groups.groupOrders[0]!.status
  const theDelivery = () => store.deliveries[0]!

  beforeEach(async () => {
    current = NOW
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    store = new InMemoryDeliveryStore(groups, users)
    publisher = new RecordingPublisher()
    delivery = createDeliveryService({
      store,
      realtime: publisher,
      generateCode: () => '4821',
      now: () => current,
    })

    const relais = await users.create({ phone: '+224621000000', name: 'Mamadou' })
    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: relais.id,
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center, 3e étage',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: DELIVERY_TIME,
      paymentMode: 'SPLIT',
      status: 'CLOSED',
    })
    const item = (dish: string, status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') =>
      groups.orderItems.push({
        id: `item_${groups.orderItems.length + 1}`,
        groupOrderId: 'group_1',
        participantName: 'Participant',
        menuItemName: dish,
        quantity: 1,
        status,
      })
    item('Riz gras')
    item('Riz gras')
    item('Attiéké poisson')
    item('Riz gras', 'CANCELLED') // jamais livré

    driver = await store.addDriver({ phone: '+224623000000', name: 'Ibrahima' })
    otherDriver = await store.addDriver({ phone: '+224624000000', name: 'Sékou' })
  })

  describe('assign — l’équipe choisit un livreur', () => {
    it('crée la livraison pour une commande fermée et trace l’action', async () => {
      const result = await delivery.assign(OPS, 'group_1', driver.id)

      expect(result).toEqual({
        deliveryId: expect.any(String),
        groupOrderId: 'group_1',
        driverId: driver.id,
        reassigned: false,
      })
      expect(theDelivery()).toMatchObject({
        status: 'ASSIGNED',
        driverId: driver.id,
        confirmationCode: null,
      })
      expect(store.auditLogs).toEqual([
        {
          actorId: OPS,
          action: 'delivery.driver_assigned',
          targetType: 'Delivery',
          targetId: theDelivery().id,
          metadata: { groupOrderId: 'group_1', driverId: driver.id },
        },
      ])
    })

    it.each(['OPEN', 'CANCELLED', 'IN_DELIVERY', 'DELIVERED'] as const)(
      'refuse une commande %s : seule une commande fermée se livre (409 GROUP_ORDER_NOT_READY)',
      async (status) => {
        groups.groupOrders[0]!.status = status

        await expect(delivery.assign(OPS, 'group_1', driver.id)).rejects.toMatchObject({
          statusCode: 409,
          code: 'GROUP_ORDER_NOT_READY',
        })
        expect(store.deliveries).toHaveLength(0)
      },
    )

    it('refuse une commande inconnue, un livreur inconnu ou désactivé', async () => {
      await expect(delivery.assign(OPS, 'inconnue', driver.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'GROUP_ORDER_NOT_FOUND',
      })
      await expect(delivery.assign(OPS, 'group_1', 'inconnu')).rejects.toMatchObject({
        statusCode: 404,
        code: 'DRIVER_NOT_FOUND',
      })
      store.drivers.find((d) => d.id === driver.id)!.active = false
      await expect(delivery.assign(OPS, 'group_1', driver.id)).rejects.toMatchObject({
        statusCode: 422,
        code: 'DRIVER_INACTIVE',
      })
    })

    it('réassigne un autre livreur tant que le premier n’a pas récupéré les plats', async () => {
      await delivery.assign(OPS, 'group_1', driver.id)

      const result = await delivery.assign(OPS, 'group_1', otherDriver.id)

      expect(result).toMatchObject({ driverId: otherDriver.id, reassigned: true })
      expect(store.deliveries).toHaveLength(1)
      expect(theDelivery().driverId).toBe(otherDriver.id)
      expect(store.auditLogs).toHaveLength(2)
    })

    it('ne réassigne plus une fois les plats récupérés (409 DELIVERY_ALREADY_STARTED)', async () => {
      await delivery.assign(OPS, 'group_1', driver.id)
      await delivery.pickUp(driver.userId, theDelivery().id)

      await expect(delivery.assign(OPS, 'group_1', otherDriver.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DELIVERY_ALREADY_STARTED',
      })
    })
  })

  describe('listForDriver — la tournée du livreur', () => {
    beforeEach(async () => {
      await delivery.assign(OPS, 'group_1', driver.id)
    })

    it('donne le manifeste : où récupérer, quoi récupérer, où livrer', async () => {
      const [manifest] = await delivery.listForDriver(driver.userId)

      expect(manifest).toEqual({
        id: theDelivery().id,
        status: 'ASSIGNED',
        deliveryAddress: 'Kaloum Center, 3e étage',
        deliveryTime: DELIVERY_TIME,
        restaurant: { name: 'Chez Aïssatou', address: 'Almamya', phone: '+224622000000' },
        dishes: [
          { dish: 'Riz gras', quantity: 2 },
          { dish: 'Attiéké poisson', quantity: 1 },
        ],
        totalDishes: 3,
        contact: null, // le contact sur place n'est donné qu'une fois les plats récupérés
      })
    })

    it('ne compte que les plats payés : une part annulée n’est jamais livrée', async () => {
      const [manifest] = await delivery.listForDriver(driver.userId)

      expect(manifest!.totalDishes).toBe(3)
    })

    it('ne montre que ses propres livraisons, et pas celles déjà livrées', async () => {
      expect(await delivery.listForDriver(otherDriver.userId)).toEqual([])

      await delivery.pickUp(driver.userId, theDelivery().id)
      await delivery.confirm(driver.userId, theDelivery().id, '4821')

      expect(await delivery.listForDriver(driver.userId)).toEqual([])
    })

    it('refuse quelqu’un qui n’est pas livreur, ou un livreur désactivé (403 FORBIDDEN)', async () => {
      await expect(delivery.listForDriver('user_inconnu')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      })
      store.drivers.find((d) => d.id === driver.id)!.active = false
      await expect(delivery.listForDriver(driver.userId)).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  describe('pickUp — « récupéré chez le restaurant »', () => {
    beforeEach(async () => {
      await delivery.assign(OPS, 'group_1', driver.id)
    })

    it('passe la livraison et la commande en route, et génère le code', async () => {
      await delivery.pickUp(driver.userId, theDelivery().id)

      expect(theDelivery()).toMatchObject({
        status: 'PICKED_UP',
        confirmationCode: '4821',
        pickedUpAt: NOW,
      })
      expect(orderStatus()).toBe('IN_DELIVERY')
    })

    it('révèle le code au groupe en direct, avec le temps restant estimé', async () => {
      await delivery.pickUp(driver.userId, theDelivery().id)

      expect(publisher.published).toEqual([
        {
          room: 'groupOrder:group_1',
          event: 'groupOrder:in_delivery',
          payload: { confirmationCode: '4821', estimatedMinutes: 35 },
        },
      ])
    })

    it('donne alors au livreur le contact sur place, mais jamais le code', async () => {
      const manifest = await delivery.pickUp(driver.userId, theDelivery().id)

      expect(manifest.contact).toEqual({ name: 'Mamadou', phone: '+224621000000' })
      expect(JSON.stringify(manifest)).not.toContain('4821')
    })

    it('ne compte pas d’estimation négative quand le livreur est en retard', async () => {
      current = new Date('2026-09-21T12:00:00.000Z')

      await delivery.pickUp(driver.userId, theDelivery().id)

      expect(publisher.published[0]!.payload).toMatchObject({ estimatedMinutes: 0 })
    })

    it('refuse la livraison d’un autre livreur (404, sans révéler qu’elle existe)', async () => {
      await expect(delivery.pickUp(otherDriver.userId, theDelivery().id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'DELIVERY_NOT_FOUND',
      })
      expect(theDelivery().status).toBe('ASSIGNED')
    })

    it('ne se fait qu’une fois (409 INVALID_DELIVERY_STATE), sans régénérer le code', async () => {
      await delivery.pickUp(driver.userId, theDelivery().id)

      await expect(delivery.pickUp(driver.userId, theDelivery().id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_DELIVERY_STATE',
      })
      expect(publisher.published).toHaveLength(1)
    })
  })

  describe('confirm — le code prouve que la livraison a eu lieu', () => {
    beforeEach(async () => {
      await delivery.assign(OPS, 'group_1', driver.id)
      await delivery.pickUp(driver.userId, theDelivery().id)
      publisher.published.length = 0
    })

    it('valide avec le bon code : livrée, commande livrée, le groupe l’apprend', async () => {
      current = new Date('2026-09-21T11:10:00.000Z')

      const result = await delivery.confirm(driver.userId, theDelivery().id, '4821')

      expect(result).toEqual({ status: 'DELIVERED' })
      expect(theDelivery()).toMatchObject({
        status: 'DELIVERED',
        deliveredAt: current,
        deliveredByOverride: false,
      })
      expect(orderStatus()).toBe('DELIVERED')
      expect(publisher.published).toEqual([
        {
          room: 'groupOrder:group_1',
          event: 'groupOrder:delivered',
          payload: { deliveredAt: '2026-09-21T11:10:00.000Z' },
        },
        // c'est le moment de noter : la page propose de noter le restaurant (docs/09 §4)
        {
          room: 'groupOrder:group_1',
          event: 'groupOrder:rating_open',
          payload: { restaurantName: 'Chez Aïssatou' },
        },
      ])
    })

    it('refuse un mauvais code en disant combien d’essais restent (401 INVALID_CONFIRMATION_CODE)', async () => {
      await expect(delivery.confirm(driver.userId, theDelivery().id, '0000')).rejects.toMatchObject(
        {
          statusCode: 401,
          code: 'INVALID_CONFIRMATION_CODE',
          details: { attemptsLeft: MAX_CONFIRMATION_ATTEMPTS - 1 },
        },
      )
      expect(theDelivery()).toMatchObject({ status: 'PICKED_UP', confirmationAttempts: 1 })
      expect(orderStatus()).toBe('IN_DELIVERY')
      expect(publisher.published).toEqual([])
    })

    it('bloque après 5 essais ratés, même avec le bon code ensuite (429 TOO_MANY_ATTEMPTS)', async () => {
      for (let i = 0; i < MAX_CONFIRMATION_ATTEMPTS - 1; i++) {
        await expect(
          delivery.confirm(driver.userId, theDelivery().id, '0000'),
        ).rejects.toMatchObject({
          code: 'INVALID_CONFIRMATION_CODE',
        })
      }
      // le 5ᵉ échec verrouille
      await expect(delivery.confirm(driver.userId, theDelivery().id, '0000')).rejects.toMatchObject(
        {
          statusCode: 429,
          code: 'TOO_MANY_ATTEMPTS',
        },
      )

      await expect(delivery.confirm(driver.userId, theDelivery().id, '4821')).rejects.toMatchObject(
        {
          statusCode: 429,
          code: 'TOO_MANY_ATTEMPTS',
        },
      )
      expect(theDelivery().status).toBe('PICKED_UP')
    })

    it('accepte le bon code au dernier essai permis', async () => {
      for (let i = 0; i < MAX_CONFIRMATION_ATTEMPTS - 1; i++) {
        await delivery.confirm(driver.userId, theDelivery().id, '0000').catch(() => undefined)
      }

      await expect(delivery.confirm(driver.userId, theDelivery().id, '4821')).resolves.toEqual({
        status: 'DELIVERED',
      })
    })

    it('refuse avant la récupération, et une deuxième fois (409 INVALID_DELIVERY_STATE)', async () => {
      await delivery.confirm(driver.userId, theDelivery().id, '4821')

      await expect(delivery.confirm(driver.userId, theDelivery().id, '4821')).rejects.toMatchObject(
        {
          statusCode: 409,
          code: 'INVALID_DELIVERY_STATE',
        },
      )
    })

    it('refuse la livraison d’un autre livreur (404)', async () => {
      await expect(
        delivery.confirm(otherDriver.userId, theDelivery().id, '4821'),
      ).rejects.toMatchObject({ statusCode: 404, code: 'DELIVERY_NOT_FOUND' })
    })
  })

  describe('override — la sortie de secours de l’équipe', () => {
    beforeEach(async () => {
      await delivery.assign(OPS, 'group_1', driver.id)
      await delivery.pickUp(driver.userId, theDelivery().id)
      publisher.published.length = 0
      store.auditLogs.length = 0
    })

    it('confirme manuellement, marque l’override et trace toujours l’action avec sa raison', async () => {
      current = new Date('2026-09-21T11:20:00.000Z')

      await delivery.override(
        OPS,
        theDelivery().id,
        'Le relais est injoignable, livraison confirmée par téléphone',
      )

      expect(theDelivery()).toMatchObject({
        status: 'DELIVERED',
        deliveredAt: current,
        deliveredByOverride: true,
      })
      expect(orderStatus()).toBe('DELIVERED')
      expect(store.auditLogs).toEqual([
        {
          actorId: OPS,
          action: 'delivery.manual_override',
          targetType: 'Delivery',
          targetId: theDelivery().id,
          metadata: { reason: 'Le relais est injoignable, livraison confirmée par téléphone' },
        },
      ])
      expect(publisher.published.map((p) => p.event)).toEqual([
        'groupOrder:delivered',
        'groupOrder:rating_open',
      ])
    })

    it('marche aussi quand le livreur est verrouillé après 5 essais ratés', async () => {
      for (let i = 0; i < MAX_CONFIRMATION_ATTEMPTS; i++) {
        await delivery.confirm(driver.userId, theDelivery().id, '0000').catch(() => undefined)
      }

      await expect(
        delivery.override(OPS, theDelivery().id, 'Code perdu par le relais'),
      ).resolves.toBeDefined()
      expect(theDelivery().status).toBe('DELIVERED')
    })

    it('refuse une livraison déjà livrée (409) ou inconnue (404), sans écrire de trace', async () => {
      await delivery.confirm(driver.userId, theDelivery().id, '4821')
      store.auditLogs.length = 0

      await expect(delivery.override(OPS, theDelivery().id, 'Trop tard')).rejects.toMatchObject({
        statusCode: 409,
        code: 'DELIVERY_ALREADY_DELIVERED',
      })
      await expect(delivery.override(OPS, 'inconnue', 'Raison')).rejects.toMatchObject({
        statusCode: 404,
        code: 'DELIVERY_NOT_FOUND',
      })
      expect(store.auditLogs).toEqual([])
    })
  })

  describe('listOrders — ce que voit l’équipe', () => {
    it('liste les commandes à traiter avec leur récap et leur livreur', async () => {
      await delivery.assign(OPS, 'group_1', driver.id)

      const orders = await delivery.listOrders(['CLOSED'])

      expect(orders).toEqual([
        {
          id: 'group_1',
          status: 'CLOSED',
          restaurantName: 'Chez Aïssatou',
          deliveryAddress: 'Kaloum Center, 3e étage',
          orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
          deliveryTime: DELIVERY_TIME,
          dishes: [
            { dish: 'Riz gras', quantity: 2 },
            { dish: 'Attiéké poisson', quantity: 1 },
          ],
          totalDishes: 3,
          delivery: {
            id: theDelivery().id,
            status: 'ASSIGNED',
            driver: { id: driver.id, name: 'Ibrahima' },
          },
        },
      ])
    })

    it('filtre par statut, et une commande sans livreur n’a pas de livraison', async () => {
      expect((await delivery.listOrders(['CLOSED']))[0]!.delivery).toBeNull()
      expect(await delivery.listOrders(['DELIVERED'])).toEqual([])
    })
  })
})
