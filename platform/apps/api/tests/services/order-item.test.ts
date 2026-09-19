import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_JOINS_PER_IP,
  MAX_JOINS_PER_PHONE,
  createOrderItemService,
} from '../../src/services/order-item.js'
import { createPaymentService } from '../../src/services/payment.js'
import {
  InMemoryGroupOrderStore,
  InMemoryOrderItemStore,
  InMemoryPaymentStore,
  InMemoryRateLimiter,
  InMemoryUserStore,
  RecordingPaymentGateway,
  RecordingPublisher,
} from '../helpers/fakes.js'

const NOW = new Date('2026-09-21T08:00:00.000Z')
const CUTOFF = new Date('2026-09-21T10:30:00.000Z')
const DELIVERY = new Date('2026-09-21T12:00:00.000Z')
const DELIVERY_DAY = new Date('2026-09-21')

/** Numéros guinéens valides et distincts : 622 + 6 chiffres. */
const phone = (n: number) => `622${String(n).padStart(6, '0')}`

describe('OrderItemService.join', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let store: InMemoryOrderItemStore
  let publisher: RecordingPublisher
  let service: ReturnType<typeof createOrderItemService>
  let current: Date

  const join = (
    overrides: Partial<{ menuItemId: string; quantity: number; phone: string; name: string }> = {},
    ip = '203.0.113.7',
  ) =>
    service.join(
      'lien',
      { menuItemId: 'menu_riz', quantity: 1, phone: phone(1), name: 'Aïcha', ...overrides },
      ip,
    )

  beforeEach(() => {
    current = NOW
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    const paymentStore = new InMemoryPaymentStore(groups)
    store = new InMemoryOrderItemStore(groups, users, paymentStore)
    publisher = new RecordingPublisher()
    service = createOrderItemService({
      store,
      users,
      realtime: publisher,
      // Le lancement du paiement a ses propres tests (payment.test.ts) : ici, une passerelle qui accepte tout.
      payments: createPaymentService({
        store: paymentStore,
        gateway: new RecordingPaymentGateway(),
        realtime: publisher,
        now: () => current,
      }),
      rateLimiter: new InMemoryRateLimiter(),
      defaultCountryCode: '224',
      now: () => current,
    })

    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: 'user_relais',
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: CUTOFF,
      deliveryTime: DELIVERY,
      paymentMode: 'SPLIT',
      status: 'OPEN',
    })
    const menu = (id: string, partnerId: string, date: Date, active = true) => ({
      id,
      partnerId,
      name: id === 'menu_riz' ? 'Riz gras' : id,
      description: null,
      price: 25000,
      photoUrl: null,
      availableDate: date,
      active,
    })
    groups.menuItems.push(
      menu('menu_riz', 'partner_1', DELIVERY_DAY),
      menu('menu_autre', 'partner_2', DELIVERY_DAY),
      menu('menu_demain', 'partner_1', new Date('2026-09-22')),
      menu('menu_off', 'partner_1', DELIVERY_DAY, false),
    )
  })

  describe('la commande créée', () => {
    it('est en attente de paiement, au prix du plat plus le frais du premier palier', async () => {
      const result = await join()

      expect(result).toEqual({
        id: expect.any(String),
        status: 'PENDING_PAYMENT',
        dish: 'Riz gras',
        quantity: 1,
        unitPrice: 25000,
        deliveryFee: 6000,
        amount: 31000,
        payment: { status: 'PENDING' },
      })
    })

    it('fige prix, frais de livraison et commission sur la ligne (jamais recalculés)', async () => {
      await join()

      expect(groups.orderItems[0]).toMatchObject({
        status: 'PENDING_PAYMENT',
        quantity: 1,
        unitPrice: 25000,
        deliveryFee: 6000,
        commissionAmount: 3750, // 15 % de 25 000
      })
    })

    it('multiplie le prix et la commission par la quantité, pas le frais de livraison', async () => {
      const result = await join({ quantity: 2 })

      expect(result).toMatchObject({
        quantity: 2,
        unitPrice: 25000,
        deliveryFee: 6000,
        amount: 56000,
      })
      expect(groups.orderItems[0]!.commissionAmount).toBe(7500)
    })

    it('utilise le taux de commission du partenaire', async () => {
      store.commissionRates.set('partner_1', 0.145)
      groups.menuItems[0]!.price = 1500

      await join()

      expect(groups.orderItems[0]!.commissionAmount).toBe(218) // 217,5 arrondi vers le haut
    })
  })

  describe('temps réel en HOST_PAYS (docs/09 : « en attente du règlement de [créateur] »)', () => {
    beforeEach(() => {
      groups.groupOrders[0]!.paymentMode = 'HOST_PAYS'
    })

    it('annonce tout de suite la personne au groupe, marquée en attente', async () => {
      await join({ name: 'Aïcha' })

      expect(publisher.published).toEqual([
        {
          room: 'groupOrder:group_1',
          event: 'groupOrder:item_pending',
          payload: {
            participant: { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: true },
            nextDeliveryFee: 6000, // le prochain arrivant sera le 2ᵉ
          },
        },
      ])
    })

    it('annonce le nom du compte, pas celui saisi (pas d’usurpation sur la liste publique)', async () => {
      await users.create({ phone: '+224622000001', name: 'Aïcha Diallo' })

      await join({ name: 'Quelqu’un d’autre' })

      expect(publisher.published[0]!.payload).toMatchObject({
        participant: { name: 'Aïcha Diallo' },
      })
    })

    it('le tarif annoncé baisse avec le rang', async () => {
      for (let n = 1; n <= 2; n++) await join({ phone: phone(n) })

      // 2 commandes : le prochain sera le 3ᵉ, deuxième palier
      expect(publisher.published.at(-1)!.payload).toMatchObject({ nextDeliveryFee: 5000 })
    })

    it('n’annonce rien quand la commande est refusée', async () => {
      await expect(join({ menuItemId: 'inconnu' })).rejects.toThrow()

      expect(publisher.published).toEqual([])
    })
  })

  describe('temps réel en SPLIT', () => {
    it('n’annonce rien à la création de la commande : seul un paiement confirmé compte', async () => {
      await join()

      expect(publisher.published).toEqual([])
    })
  })

  describe('le tarif dégressif selon le rang (docs/04)', () => {
    it('baisse par palier et ne change jamais pour ceux qui ont déjà commandé', async () => {
      for (let n = 1; n <= 10; n++) await join({ phone: phone(n) })

      expect(groups.orderItems.map((i) => i.deliveryFee)).toEqual([
        6000, 6000, 5000, 5000, 5000, 4000, 4000, 4000, 4000, 3000,
      ])
    })

    it('ne compte pas les commandes annulées dans le rang', async () => {
      for (let n = 1; n <= 5; n++) await join({ phone: phone(n) })
      groups.orderItems[0]!.status = 'CANCELLED'

      const sixth = await join({ phone: phone(6) })

      // 4 commandes actives → rang 5 → 5 000 (avec la commande annulée, on tomberait à 4 000)
      expect(sixth.deliveryFee).toBe(5000)
    })
  })

  describe('le participant', () => {
    it('est créé silencieusement à sa première commande, sans OTP, téléphone normalisé', async () => {
      await join({ phone: '622 00 00 01', name: 'Aïcha Diallo' })

      expect(users.users).toHaveLength(1)
      expect(users.users[0]).toMatchObject({
        phone: '+224622000001',
        name: 'Aïcha Diallo',
        role: 'CLIENT',
      })
    })

    it('retrouve son compte existant sans en changer le nom (pas d’usurpation par saisie)', async () => {
      await users.create({ phone: '+224622000001', name: 'Aïcha Diallo' })

      await join({ name: 'Quelqu’un d’autre' })

      expect(users.users).toHaveLength(1)
      expect(users.users[0]!.name).toBe('Aïcha Diallo')
      expect(groups.orderItems[0]!.participantName).toBe('Aïcha Diallo')
    })

    it('ne peut pas commander deux fois sur le même lien (409 ALREADY_JOINED)', async () => {
      await join({ phone: '622 00 00 01' })

      await expect(join({ phone: '+224622000001' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALREADY_JOINED',
      })
      expect(groups.orderItems).toHaveLength(1)
    })

    it('peut recommander quand sa commande précédente a été annulée', async () => {
      await join()
      groups.orderItems[0]!.status = 'CANCELLED'

      await expect(join()).resolves.toMatchObject({ status: 'PENDING_PAYMENT' })
    })

    it('est refusé si son compte est désactivé (403 ACCOUNT_DISABLED)', async () => {
      const banned = await users.create({ phone: '+224622000001', name: 'Banni' })
      banned.isActive = false

      await expect(join()).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_DISABLED' })
      expect(groups.orderItems).toHaveLength(0)
    })

    it('doit avoir un numéro valide (400 INVALID_PHONE)', async () => {
      await expect(join({ phone: '12' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PHONE',
      })
      expect(users.users).toHaveLength(0)
    })
  })

  describe('le lien', () => {
    it('doit exister (404 GROUP_ORDER_NOT_FOUND)', async () => {
      await expect(
        service.join(
          'inconnu',
          { menuItemId: 'menu_riz', quantity: 1, phone: phone(1), name: 'A' },
          'ip',
        ),
      ).rejects.toMatchObject({ statusCode: 404, code: 'GROUP_ORDER_NOT_FOUND' })
    })

    it.each(['CLOSED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
      'n’accepte plus de commandes quand il est %s (409 GROUP_ORDER_CLOSED)',
      async (status) => {
        groups.groupOrders[0]!.status = status

        await expect(join()).rejects.toMatchObject({ statusCode: 409, code: 'GROUP_ORDER_CLOSED' })
      },
    )

    it('n’accepte plus de commandes à l’heure limite, même si le statut est encore OPEN', async () => {
      current = CUTOFF

      await expect(join()).rejects.toMatchObject({ statusCode: 409, code: 'GROUP_ORDER_CLOSED' })
      expect(groups.orderItems).toHaveLength(0)
    })

    it('accepte encore une commande une seconde avant l’heure limite', async () => {
      current = new Date(CUTOFF.getTime() - 1000)

      await expect(join()).resolves.toBeDefined()
    })
  })

  describe('le plat', () => {
    it.each([
      ['inconnu', 'inconnu'],
      ['d’un autre partenaire', 'menu_autre'],
      ['d’un autre jour que la livraison', 'menu_demain'],
      ['retiré du menu', 'menu_off'],
    ])('refuse un plat %s (404 MENU_ITEM_NOT_FOUND)', async (_label, menuItemId) => {
      await expect(join({ menuItemId })).rejects.toMatchObject({
        statusCode: 404,
        code: 'MENU_ITEM_NOT_FOUND',
      })
      expect(users.users).toHaveLength(0)
    })
  })

  describe('la limite de débit (endpoint public)', () => {
    it('limite les tentatives par numéro, échecs compris (429 RATE_LIMIT_EXCEEDED)', async () => {
      for (let i = 0; i < MAX_JOINS_PER_PHONE; i++) await join().catch(() => undefined)

      await expect(join()).rejects.toMatchObject({ statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' })
    })

    it('ne bloque pas les autres numéros', async () => {
      for (let i = 0; i <= MAX_JOINS_PER_PHONE; i++) await join().catch(() => undefined)

      await expect(join({ phone: phone(2) })).resolves.toBeDefined()
    })

    it('limite par IP, assez large pour tout un bureau derrière la même box', async () => {
      for (let n = 1; n <= MAX_JOINS_PER_IP; n++) await join({ phone: phone(n) })
      const usersBefore = users.users.length

      await expect(join({ phone: phone(MAX_JOINS_PER_IP + 1) })).rejects.toMatchObject({
        statusCode: 429,
      })
      // Une requête bloquée ne crée aucun compte.
      expect(users.users).toHaveLength(usersBefore)
    })

    it('ne compte pas les IP entre elles', async () => {
      for (let n = 1; n <= MAX_JOINS_PER_IP; n++) await join({ phone: phone(n) })

      await expect(join({ phone: phone(500) }, '198.51.100.9')).resolves.toBeDefined()
    })
  })
})
