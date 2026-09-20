import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_GROUP_ORDER_CREATIONS,
  MAX_GROUP_ORDER_CREATIONS_PER_IP,
  createGroupOrderService,
  generateShareToken,
} from '../../src/services/group-order.js'
import { DEFAULT_SCHEDULE_RULES } from '../../src/services/schedule.js'
import {
  InMemoryGroupOrderStore,
  InMemoryRateLimiter,
  InMemoryUserStore,
} from '../helpers/fakes.js'

// Lundi 21 septembre 2026, 10h00 à Conakry (UTC). La commande reste ouverte 20 minutes ; la
// livraison est estimée 45 minutes après la fermeture (préparation et trajet).
const NOW = new Date('2026-09-21T10:00:00.000Z')
const CUTOFF = new Date('2026-09-21T10:20:00.000Z')
const DELIVERY = new Date('2026-09-21T11:05:00.000Z')

/** Numéros guinéens valides et distincts : 622 + 6 chiffres. */
const phone = (n: number) => `622${String(n).padStart(6, '0')}`

describe('GroupOrderService', () => {
  let users: InMemoryUserStore
  let store: InMemoryGroupOrderStore
  let service: ReturnType<typeof createGroupOrderService>
  let relaisId: string

  const serviceAt = (
    now: Date,
    extra: Partial<Parameters<typeof createGroupOrderService>[0]> = {},
  ) =>
    createGroupOrderService({
      store,
      users,
      rateLimiter: new InMemoryRateLimiter(),
      defaultCountryCode: '224',
      rules: DEFAULT_SCHEDULE_RULES,
      now: () => now,
      generateShareToken: () => 'token-fixe',
      ...extra,
    })

  const byRelais = () => ({ userId: relaisId })
  const withoutAccount = (n = 1, name = 'Aïcha', clientIp = '203.0.113.7') => ({
    phone: phone(n),
    name,
    clientIp,
  })

  const validInput = () => ({
    partnerId: 'partner_1',
    deliveryAddress: 'Immeuble Kaloum Center, 3e étage',
  })

  beforeEach(async () => {
    users = new InMemoryUserStore()
    store = new InMemoryGroupOrderStore(users)
    service = serviceAt(NOW)
    relaisId = (await users.create({ phone: '+224621000000', name: 'Mamadou' })).id
    store.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    // Sans plat au menu ce jour-là, pas de commande possible : un plat suffit pour ces tests.
    store.menuItems.push({
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

  describe('create — commencer une commande', () => {
    it('crée une commande ouverte 20 minutes, en mode SPLIT, avec le jeton du lien à partager', async () => {
      const created = await service.create(byRelais(), validInput())

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

    it('enregistre le créateur, le restaurant et les heures calculées', async () => {
      await service.create(byRelais(), validInput())

      expect(store.groupOrders).toHaveLength(1)
      expect(store.groupOrders[0]).toMatchObject({
        creatorId: relaisId,
        partnerId: 'partner_1',
        shareToken: 'token-fixe',
        orderCutoffTime: CUTOFF,
        deliveryTime: DELIVERY,
      })
    })

    it('refuse un restaurant inconnu ou désactivé (404 PARTNER_NOT_FOUND)', async () => {
      await expect(
        service.create(byRelais(), { ...validInput(), partnerId: 'inconnu' }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'PARTNER_NOT_FOUND' })

      store.partners[0]!.active = false
      await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARTNER_NOT_FOUND',
      })
    })

    describe('règles d’horaires', () => {
      it('n’ouvre pas avant 9h (422 SERVICE_NOT_OPEN)', async () => {
        const early = serviceAt(new Date('2026-09-21T08:30:00.000Z'))

        await expect(early.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 422,
          code: 'SERVICE_NOT_OPEN',
        })
        expect(store.groupOrders).toHaveLength(0)
      })

      it('refuse une commande qui ne serait pas livrée avant minuit (422 TOO_LATE_TO_DELIVER)', async () => {
        const late = serviceAt(new Date('2026-09-21T23:00:00.000Z'))

        await expect(late.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 422,
          code: 'TOO_LATE_TO_DELIVER',
        })
      })

      it('refuse un restaurant fermé quand il recevrait la commande (422 PARTNER_CLOSED_AT_THAT_TIME)', async () => {
        // ne sert que de 11h à 15h : la commande de 10h00 se ferme à 10h20, il n'a pas ouvert
        Object.assign(store.partners[0]!, { serviceStartMinute: 660, serviceEndMinute: 900 })

        await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 422,
          code: 'PARTNER_CLOSED_AT_THAT_TIME',
        })
      })

      it('refuse un restaurant sans plat au menu ce jour-là (422 NO_MENU_FOR_DATE)', async () => {
        store.menuItems.length = 0

        await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 422,
          code: 'NO_MENU_FOR_DATE',
        })
      })

      it('ne compte pas un plat retiré du menu', async () => {
        store.menuItems[0]!.active = false

        await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
          code: 'NO_MENU_FOR_DATE',
        })
      })
    })

    describe('mode de paiement', () => {
      it('refuse HOST_PAYS tant que la charge unique du créateur n’existe pas (422 PAYMENT_MODE_UNAVAILABLE)', async () => {
        await expect(
          service.create(byRelais(), { ...validInput(), paymentMode: 'HOST_PAYS' }),
        ).rejects.toMatchObject({ statusCode: 422, code: 'PAYMENT_MODE_UNAVAILABLE' })
        expect(store.groupOrders).toHaveLength(0)
      })

      it('accepte HOST_PAYS quand il est activé', async () => {
        const enabled = serviceAt(NOW, { hostPaysEnabled: true })

        const created = await enabled.create(byRelais(), {
          ...validInput(),
          paymentMode: 'HOST_PAYS',
        })

        expect(created.paymentMode).toBe('HOST_PAYS')
      })
    })

    describe('avec un compte (jeton)', () => {
      it('refuse un créateur dont le compte est désactivé (401)', async () => {
        users.users[0]!.isActive = false

        await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
        expect(store.groupOrders).toHaveLength(0)
      })

      it('limite le nombre de commandes lancées par utilisateur (429 RATE_LIMIT_EXCEEDED)', async () => {
        for (let i = 0; i < MAX_GROUP_ORDER_CREATIONS; i++) {
          await service.create(byRelais(), validInput())
        }

        await expect(service.create(byRelais(), validInput())).rejects.toMatchObject({
          statusCode: 429,
          code: 'RATE_LIMIT_EXCEEDED',
        })
      })

      it('ne compte pas les commandes des autres utilisateurs dans la limite', async () => {
        const other = await users.create({ phone: '+224622000000', name: 'Aïcha' })
        for (let i = 0; i < MAX_GROUP_ORDER_CREATIONS; i++) {
          await service.create(byRelais(), validInput())
        }

        await expect(service.create({ userId: other.id }, validInput())).resolves.toBeDefined()
      })
    })

    describe('sans compte : téléphone et nom, comme pour rejoindre', () => {
      it('crée le compte discrètement, numéro normalisé, sans OTP', async () => {
        const created = await service.create(withoutAccount(1, 'Aïcha Diallo'), validInput())

        expect(created.shareToken).toBe('token-fixe')
        const account = users.users.find((u) => u.phone === '+224622000001')
        expect(account).toMatchObject({ name: 'Aïcha Diallo', role: 'CLIENT', isActive: true })
        expect(store.groupOrders[0]!.creatorId).toBe(account!.id)
      })

      it('retrouve un compte existant sans changer son nom (pas d’usurpation par saisie)', async () => {
        await users.create({ phone: '+224622000001', name: 'Aïcha Diallo' })

        await service.create(withoutAccount(1, 'Quelqu’un d’autre'), validInput())

        expect(users.users.filter((u) => u.phone === '+224622000001')).toHaveLength(1)
        expect(users.users.find((u) => u.phone === '+224622000001')!.name).toBe('Aïcha Diallo')
      })

      it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
        await expect(
          service.create({ ...withoutAccount(), phone: '12' }, validInput()),
        ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PHONE' })
        expect(users.users).toHaveLength(1) // seulement le relais du test
      })

      it('refuse un compte désactivé (403 ACCOUNT_DISABLED)', async () => {
        const banned = await users.create({ phone: '+224622000001', name: 'Banni' })
        banned.isActive = false

        await expect(service.create(withoutAccount(1), validInput())).rejects.toMatchObject({
          statusCode: 403,
          code: 'ACCOUNT_DISABLED',
        })
        expect(store.groupOrders).toHaveLength(0)
      })

      it('limite par IP, avant de créer le moindre compte (429 RATE_LIMIT_EXCEEDED)', async () => {
        for (let n = 1; n <= MAX_GROUP_ORDER_CREATIONS_PER_IP; n++) {
          await service.create(withoutAccount(n), validInput())
        }
        const accountsBefore = users.users.length

        await expect(
          service.create(withoutAccount(MAX_GROUP_ORDER_CREATIONS_PER_IP + 1), validInput()),
        ).rejects.toMatchObject({ statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' })
        expect(users.users).toHaveLength(accountsBefore)
      })

      it('ne mélange pas les IP', async () => {
        for (let n = 1; n <= MAX_GROUP_ORDER_CREATIONS_PER_IP; n++) {
          await service.create(withoutAccount(n), validInput())
        }

        await expect(
          service.create(withoutAccount(900, 'Autre', '198.51.100.9'), validInput()),
        ).resolves.toBeDefined()
      })
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
      shareToken = (await service.create(byRelais(), validInput())).shareToken
    })

    const seedMenu = () => {
      const base = { description: null, photoUrl: null, active: true }
      store.menuItems.push(
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
      store.groupOrders[0]!.deliveryTime = new Date('2026-09-21T23:30:00.000Z')

      const { menu } = await service.getByShareToken(shareToken)

      expect(menu.map((m) => m.id)).toContain('menu_riz')
      expect(menu.map((m) => m.id)).not.toContain('menu_demain')
    })

    describe('rating — la moyenne du jour, une fois livrée', () => {
      it('est absente tant que personne n’a noté', async () => {
        expect((await service.getByShareToken(shareToken)).rating).toBeNull()
      })

      it('donne la moyenne et le nombre de notes de la commande', async () => {
        store.ratingOf = () => ({ average: 4.5, count: 2 })

        expect((await service.getByShareToken(shareToken)).rating).toEqual({
          average: 4.5,
          count: 2,
        })
      })
    })

    describe('delivery — la preuve de livraison sur la page du groupe', () => {
      const stored = (status: 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED', code: string | null) => {
        store.deliveryOf = () => ({ status, confirmationCode: code })
      }

      it('est absente tant qu’aucun livreur n’est assigné', async () => {
        expect((await service.getByShareToken(shareToken)).delivery).toBeNull()
      })

      it('annonce le livreur assigné sans aucun code', async () => {
        stored('ASSIGNED', null)

        expect((await service.getByShareToken(shareToken)).delivery).toEqual({
          status: 'ASSIGNED',
          confirmationCode: null,
        })
      })

      it('révèle le code à donner au livreur une fois les plats récupérés', async () => {
        stored('PICKED_UP', '4821')

        expect((await service.getByShareToken(shareToken)).delivery).toEqual({
          status: 'PICKED_UP',
          confirmationCode: '4821',
        })
      })

      it('ne montre jamais le code hors de la phase « en route » : avant, il pourrait fuiter ; après, il ne sert plus', async () => {
        stored('ASSIGNED', '4821')
        expect((await service.getByShareToken(shareToken)).delivery?.confirmationCode).toBeNull()

        stored('DELIVERED', '4821')
        expect((await service.getByShareToken(shareToken)).delivery).toEqual({
          status: 'DELIVERED',
          confirmationCode: null,
        })
      })
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
