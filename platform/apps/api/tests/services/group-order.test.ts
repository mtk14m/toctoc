import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_GROUP_ORDER_CREATIONS,
  createGroupOrderService,
  generateShareToken,
} from '../../src/services/group-order.js'
import {
  InMemoryGroupOrderStore,
  InMemoryRateLimiter,
  InMemoryUserStore,
} from '../helpers/fakes.js'

const NOW = new Date('2026-09-21T08:00:00.000Z')
const CUTOFF = new Date('2026-09-21T10:30:00.000Z')
const DELIVERY = new Date('2026-09-21T12:00:00.000Z')

describe('GroupOrderService', () => {
  let users: InMemoryUserStore
  let store: InMemoryGroupOrderStore
  let service: ReturnType<typeof createGroupOrderService>
  let relaisId: string

  const validInput = () => ({
    partnerId: 'partner_1',
    deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
    orderCutoffTime: CUTOFF,
    deliveryTime: DELIVERY,
  })

  beforeEach(async () => {
    users = new InMemoryUserStore()
    store = new InMemoryGroupOrderStore(users)
    service = createGroupOrderService({
      store,
      users,
      rateLimiter: new InMemoryRateLimiter(),
      now: () => NOW,
      generateShareToken: () => 'token-fixe',
    })
    relaisId = (await users.create({ phone: '+224621000000', name: 'Mamadou' })).id
    store.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
  })

  describe('create', () => {
    it('crée un lien ouvert, en mode SPLIT par défaut, avec le token généré', async () => {
      const created = await service.create(relaisId, validInput())

      expect(created).toEqual({
        id: expect.any(String),
        shareToken: 'token-fixe',
        status: 'OPEN',
        deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
        orderCutoffTime: CUTOFF,
        deliveryTime: DELIVERY,
        paymentMode: 'SPLIT',
      })
    })

    it('enregistre le créateur, le partenaire et les horaires', async () => {
      await service.create(relaisId, validInput())

      expect(store.groupOrders).toHaveLength(1)
      expect(store.groupOrders[0]).toMatchObject({
        creatorId: relaisId,
        partnerId: 'partner_1',
        shareToken: 'token-fixe',
        orderCutoffTime: CUTOFF,
        deliveryTime: DELIVERY,
      })
    })

    it('accepte le mode HOST_PAYS (« j’invite tout le monde »)', async () => {
      const created = await service.create(relaisId, { ...validInput(), paymentMode: 'HOST_PAYS' })

      expect(created.paymentMode).toBe('HOST_PAYS')
    })

    it('refuse un partenaire inconnu (404 PARTNER_NOT_FOUND)', async () => {
      await expect(
        service.create(relaisId, { ...validInput(), partnerId: 'inconnu' }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'PARTNER_NOT_FOUND' })
    })

    it('refuse un partenaire désactivé (404 PARTNER_NOT_FOUND)', async () => {
      store.partners[0]!.active = false

      await expect(service.create(relaisId, validInput())).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARTNER_NOT_FOUND',
      })
    })

    it('refuse une heure limite déjà passée (422 CUTOFF_IN_PAST)', async () => {
      const past = new Date(NOW.getTime() - 60_000)

      await expect(
        service.create(relaisId, { ...validInput(), orderCutoffTime: past }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'CUTOFF_IN_PAST' })
    })

    it('refuse une heure limite égale à maintenant', async () => {
      await expect(
        service.create(relaisId, { ...validInput(), orderCutoffTime: NOW }),
      ).rejects.toMatchObject({ code: 'CUTOFF_IN_PAST' })
    })

    it('refuse une livraison qui n’est pas après l’heure limite (422 DELIVERY_BEFORE_CUTOFF)', async () => {
      await expect(
        service.create(relaisId, { ...validInput(), deliveryTime: CUTOFF }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'DELIVERY_BEFORE_CUTOFF' })
    })

    it('refuse un créateur dont le compte est désactivé (401)', async () => {
      users.users[0]!.isActive = false

      await expect(service.create(relaisId, validInput())).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      })
      expect(store.groupOrders).toHaveLength(0)
    })

    it('limite le nombre de liens créés par utilisateur (429 RATE_LIMIT_EXCEEDED)', async () => {
      for (let i = 0; i < MAX_GROUP_ORDER_CREATIONS; i++) {
        await service.create(relaisId, validInput())
      }

      await expect(service.create(relaisId, validInput())).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      })
    })

    it('ne compte pas les créations des autres utilisateurs dans la limite', async () => {
      const other = await users.create({ phone: '+224622000000', name: 'Aïcha' })
      for (let i = 0; i < MAX_GROUP_ORDER_CREATIONS; i++) {
        await service.create(relaisId, validInput())
      }

      await expect(service.create(other.id, validInput())).resolves.toBeDefined()
    })
  })

  describe('generateShareToken', () => {
    it('produit des jetons non séquentiels, sûrs dans une URL', () => {
      const tokens = new Set(Array.from({ length: 50 }, generateShareToken))

      expect(tokens.size).toBe(50)
      for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    })
  })

  describe('getByShareToken', () => {
    let shareToken: string

    beforeEach(async () => {
      shareToken = (await service.create(relaisId, validInput())).shareToken
    })

    const seedMenu = () => {
      const base = { description: null, photoUrl: null, active: true }
      store.menuItems.push(
        {
          ...base,
          id: 'menu_riz',
          partnerId: 'partner_1',
          name: 'Riz gras',
          price: 25000,
          availableDate: new Date('2026-09-21'),
        },
        {
          ...base,
          id: 'menu_attieke',
          partnerId: 'partner_1',
          name: 'Attiéké poisson',
          price: 30000,
          availableDate: new Date('2026-09-21'),
        },
        {
          ...base,
          id: 'menu_demain',
          partnerId: 'partner_1',
          name: 'Plat de demain',
          price: 20000,
          availableDate: new Date('2026-09-22'),
        },
        {
          ...base,
          id: 'menu_autre',
          partnerId: 'partner_2',
          name: 'Plat d’un autre',
          price: 20000,
          availableDate: new Date('2026-09-21'),
        },
        {
          ...base,
          id: 'menu_off',
          partnerId: 'partner_1',
          name: 'Plat retiré',
          price: 20000,
          availableDate: new Date('2026-09-21'),
          active: false,
        },
      )
    }

    const seedItem = (
      name: string,
      dish: string,
      status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED',
    ) =>
      store.orderItems.push({
        id: `item_${store.orderItems.length + 1}`,
        groupOrderId: store.groupOrders[0]!.id,
        participantName: name,
        menuItemName: dish,
        quantity: 1,
        status,
      })

    it('renvoie le lien, le partenaire et le nom du créateur', async () => {
      const view = await service.getByShareToken(shareToken)

      expect(view).toMatchObject({
        status: 'OPEN',
        deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
        orderCutoffTime: CUTOFF,
        deliveryTime: DELIVERY,
        paymentMode: 'SPLIT',
        creatorName: 'Mamadou',
        partner: { name: 'Chez Aïssatou', type: 'CUISINE_MAISON' },
      })
    })

    it('répond 404 GROUP_ORDER_NOT_FOUND pour un jeton inconnu', async () => {
      await expect(service.getByShareToken('inconnu')).rejects.toMatchObject({
        statusCode: 404,
        code: 'GROUP_ORDER_NOT_FOUND',
      })
    })

    it('propose le menu du partenaire pour le jour de la livraison, plats actifs seulement', async () => {
      seedMenu()

      const { menu } = await service.getByShareToken(shareToken)

      expect(menu.map((m) => m.name).sort()).toEqual(['Attiéké poisson', 'Riz gras'])
      expect(menu.find((m) => m.name === 'Riz gras')).toEqual({
        id: 'menu_riz',
        name: 'Riz gras',
        description: null,
        price: 25000,
        photoUrl: null,
      })
    })

    it('lit le jour de la livraison en UTC (la Guinée est en UTC, sans heure d’été)', async () => {
      seedMenu()
      const late = { ...validInput(), deliveryTime: new Date('2026-09-21T23:30:00.000Z') }
      const { shareToken: lateToken } = await service.create(relaisId, { ...late })

      const { menu } = await service.getByShareToken(lateToken)

      expect(menu.map((m) => m.id)).toContain('menu_riz')
      expect(menu.map((m) => m.id)).not.toContain('menu_demain')
    })

    describe('participants', () => {
      beforeEach(() => {
        seedItem('Aïcha', 'Riz gras', 'CONFIRMED')
        seedItem('Ibrahima', 'Attiéké poisson', 'PENDING_PAYMENT')
        seedItem('Fatou', 'Riz gras', 'CANCELLED')
      })

      it('en SPLIT, ne montre que les commandes réellement payées', async () => {
        const { participants } = await service.getByShareToken(shareToken)

        expect(participants).toEqual([
          { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
        ])
      })

      it('en HOST_PAYS, montre les commandes en attente du règlement du créateur', async () => {
        store.groupOrders[0]!.paymentMode = 'HOST_PAYS'

        const { participants } = await service.getByShareToken(shareToken)

        expect(participants).toEqual([
          { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
          { name: 'Ibrahima', dish: 'Attiéké poisson', quantity: 1, pending: true },
        ])
      })

      it('ne montre jamais une commande annulée', async () => {
        for (const mode of ['SPLIT', 'HOST_PAYS'] as const) {
          store.groupOrders[0]!.paymentMode = mode

          const { participants } = await service.getByShareToken(shareToken)

          expect(participants.map((p) => p.name)).not.toContain('Fatou')
        }
      })
    })

    describe('nextDeliveryFee — le tarif que paiera le prochain arrivant (le waouh n°2)', () => {
      it('démarre au premier palier quand personne n’a encore commandé', async () => {
        const view = await service.getByShareToken(shareToken)

        expect(view.nextDeliveryFee).toBe(6000)
      })

      it('baisse avec les commandes en cours, payées ou non, comme le rang réel d’un arrivant', async () => {
        seedItem('Aïcha', 'Riz gras', 'CONFIRMED')
        seedItem('Ibrahima', 'Riz gras', 'PENDING_PAYMENT')

        // 2 commandes actives : le prochain sera le 3ᵉ, deuxième palier
        expect((await service.getByShareToken(shareToken)).nextDeliveryFee).toBe(5000)
      })

      it('ne compte pas les commandes annulées', async () => {
        seedItem('Aïcha', 'Riz gras', 'CONFIRMED')
        seedItem('Fatou', 'Riz gras', 'CANCELLED')
        seedItem('Ibrahima', 'Riz gras', 'CANCELLED')

        expect((await service.getByShareToken(shareToken)).nextDeliveryFee).toBe(6000)
      })

      it('s’arrête au plancher, quel que soit le nombre de participants', async () => {
        for (let i = 0; i < 25; i++) seedItem(`Collègue ${i}`, 'Riz gras', 'CONFIRMED')

        expect((await service.getByShareToken(shareToken)).nextDeliveryFee).toBe(3000)
      })
    })
  })
})
