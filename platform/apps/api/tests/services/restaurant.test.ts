import { beforeEach, describe, expect, it } from 'vitest'
import { createPartnerService } from '../../src/services/partner.js'
import { createRestaurantService } from '../../src/services/restaurant.js'
import { DEFAULT_SCHEDULE_RULES } from '../../src/services/schedule.js'
import { InMemoryPartnerStore, InMemoryRestaurantStore } from '../helpers/fakes.js'

// Lundi 21 septembre 2026, 10h00 à Conakry (UTC).
const NOW = new Date('2026-09-21T10:00:00.000Z')

describe('RestaurantService — l’annuaire public', () => {
  let partnerStore: InMemoryPartnerStore
  let store: InMemoryRestaurantStore
  let partners: ReturnType<typeof createPartnerService>
  let restaurants: ReturnType<typeof createRestaurantService>
  let now: Date

  const addRestaurant = async (overrides: Record<string, unknown> = {}) =>
    partners.createPartner({
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      phone: '622000000',
      address: 'Almamya, derrière la pharmacie',
      city: 'Conakry',
      ...overrides,
    })

  const addDish = (partnerId: string, name: string, price = 25000, date = '2026-09-21') =>
    partners.addMenuItem(partnerId, { name, price, availableDate: new Date(date) })

  beforeEach(() => {
    now = NOW
    partnerStore = new InMemoryPartnerStore()
    store = new InMemoryRestaurantStore(partnerStore)
    partners = createPartnerService({ store: partnerStore, defaultCountryCode: '224' })
    restaurants = createRestaurantService({
      store,
      rules: DEFAULT_SCHEDULE_RULES,
      now: () => now,
    })
  })

  describe('list', () => {
    it('présente chaque restaurant actif : ce qu’il faut pour choisir', async () => {
      const aissatou = await addRestaurant({
        description: 'Cuisine guinéenne du quotidien, faite maison.',
        logoUrl: 'https://cdn.example.com/aissatou-logo.png',
        coverUrl: 'https://cdn.example.com/aissatou-cover.jpg',
        tags: ['riz gras', 'poulet braisé'],
      })
      await addDish(aissatou.id, 'Riz gras', 25000)

      const [card] = await restaurants.list()

      expect(card).toEqual({
        id: aissatou.id,
        name: 'Chez Aïssatou',
        type: 'CUISINE_MAISON',
        city: 'Conakry',
        description: 'Cuisine guinéenne du quotidien, faite maison.',
        logoUrl: 'https://cdn.example.com/aissatou-logo.png',
        coverUrl: 'https://cdn.example.com/aissatou-cover.jpg',
        tags: ['riz gras', 'poulet braisé'],
        hours: { start: '09:00', end: '24:00' },
        rating: null,
        todaysMenu: { count: 1, preview: [{ name: 'Riz gras', price: 25000 }] },
        availability: { available: true },
      })
    })

    it('n’expose ni téléphone, ni adresse, ni commission : rien d’interne', async () => {
      const partner = await addRestaurant({ commissionRate: 0.12 })
      await addDish(partner.id, 'Riz gras')

      const [card] = await restaurants.list()
      const serialized = JSON.stringify(card)

      expect(serialized).not.toContain('+224622000000')
      expect(serialized).not.toContain('Almamya')
      expect(serialized).not.toContain('commission')
      expect(serialized).not.toContain('0.12')
    })

    it('ne montre pas un restaurant désactivé', async () => {
      const partner = await addRestaurant()
      partnerStore.partners.find((p) => p.id === partner.id)!.active = false

      expect(await restaurants.list()).toEqual([])
    })

    it('résume le menu du jour : le nombre de plats et un aperçu de trois, jamais ceux d’un autre jour', async () => {
      const partner = await addRestaurant()
      for (const name of ['Riz gras', 'Attiéké poisson', 'Poulet braisé', 'Sauce feuille']) {
        await addDish(partner.id, name)
      }
      await addDish(partner.id, 'Plat de demain', 20000, '2026-09-22')

      const [card] = await restaurants.list()

      expect(card!.todaysMenu.count).toBe(4)
      expect(card!.todaysMenu.preview.map((dish) => dish.name)).toEqual([
        'Attiéké poisson',
        'Poulet braisé',
        'Riz gras',
      ])
    })

    describe('disponibilité maintenant', () => {
      it('dit pourquoi on ne peut pas commander : aucun plat au menu ce jour-là', async () => {
        const partner = await addRestaurant()
        await addDish(partner.id, 'Plat de demain', 20000, '2026-09-22')

        const [card] = await restaurants.list()

        expect(card!.availability).toEqual({ available: false, reason: 'NO_MENU_FOR_DATE' })
      })

      it('une cuisinière du déjeuner est fermée le matin, avec ses heures pour l’afficher', async () => {
        const partner = await addRestaurant({ serviceStartMinute: 660, serviceEndMinute: 900 })
        await addDish(partner.id, 'Riz gras')

        const [card] = await restaurants.list()

        expect(card!.hours).toEqual({ start: '11:00', end: '15:00' })
        expect(card!.availability).toEqual({
          available: false,
          reason: 'PARTNER_CLOSED_AT_THAT_TIME',
          details: { opensAt: '11:00', closesAt: '15:00' },
        })
      })

      it('suit l’horloge : rien n’est disponible avant 9h, ni trop tard pour être livré avant minuit', async () => {
        const partner = await addRestaurant()
        await addDish(partner.id, 'Riz gras')

        now = new Date('2026-09-21T08:00:00.000Z')
        expect((await restaurants.list())[0]!.availability).toMatchObject({
          available: false,
          reason: 'SERVICE_NOT_OPEN',
        })

        now = new Date('2026-09-21T23:00:00.000Z')
        expect((await restaurants.list())[0]!.availability).toMatchObject({
          available: false,
          reason: 'TOO_LATE_TO_DELIVER',
        })
      })
    })

    describe('note', () => {
      it('affiche la moyenne (une décimale) et le nombre de notes', async () => {
        const partner = await addRestaurant()
        store.ratings.set(partner.id, { average: 4.6666, count: 12 })

        const [card] = await restaurants.list()

        expect(card!.rating).toEqual({ average: 4.7, count: 12 })
      })

      it('n’affiche aucune note tant qu’il n’y en a pas (jamais « 0 sur 5 »)', async () => {
        await addRestaurant()

        expect((await restaurants.list())[0]!.rating).toBeNull()
      })
    })

    describe('ordre', () => {
      it('les restaurants disponibles d’abord, puis les mieux notés, puis l’ordre alphabétique', async () => {
        const closed = await addRestaurant({ name: 'Zeta (fermé)' }) // pas de plat aujourd'hui
        const plain = await addRestaurant({ name: 'Baobab' })
        const best = await addRestaurant({ name: 'Le Palmier' })
        const alpha = await addRestaurant({ name: 'Amina' })
        for (const partner of [plain, best, alpha]) await addDish(partner.id, 'Riz gras')
        store.ratings.set(best.id, { average: 4.8, count: 20 })
        store.ratings.set(closed.id, { average: 5, count: 50 })

        const names = (await restaurants.list()).map((card) => card.name)

        expect(names).toEqual(['Le Palmier', 'Amina', 'Baobab', 'Zeta (fermé)'])
      })
    })
  })

  describe('get — la fiche d’un restaurant', () => {
    it('ajoute le menu complet du jour : plats, descriptions, prix et photos', async () => {
      const partner = await addRestaurant()
      await partners.addMenuItem(partner.id, {
        name: 'Riz gras',
        description: 'Riz au gras, poulet et légumes',
        price: 25000,
        photoUrl: 'https://cdn.example.com/riz.jpg',
        availableDate: new Date('2026-09-21'),
      })
      await addDish(partner.id, 'Attiéké poisson', 30000)
      await addDish(partner.id, 'Plat de demain', 20000, '2026-09-22')

      const detail = await restaurants.get(partner.id)

      expect(detail.name).toBe('Chez Aïssatou')
      expect(detail.menu).toEqual([
        {
          id: expect.any(String),
          name: 'Attiéké poisson',
          description: null,
          price: 30000,
          photoUrl: null,
        },
        {
          id: expect.any(String),
          name: 'Riz gras',
          description: 'Riz au gras, poulet et légumes',
          price: 25000,
          photoUrl: 'https://cdn.example.com/riz.jpg',
        },
      ])
    })

    it('garde la même fiche résumée que l’annuaire (disponibilité, note, heures)', async () => {
      const partner = await addRestaurant()
      await addDish(partner.id, 'Riz gras')
      store.ratings.set(partner.id, { average: 4.2, count: 5 })

      const { menu: _menu, ...detail } = await restaurants.get(partner.id)

      expect(detail).toEqual((await restaurants.list())[0])
    })

    it('répond 404 PARTNER_NOT_FOUND pour un restaurant inconnu ou désactivé', async () => {
      const partner = await addRestaurant()
      partnerStore.partners.find((p) => p.id === partner.id)!.active = false

      await expect(restaurants.get(partner.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARTNER_NOT_FOUND',
      })
      await expect(restaurants.get('inconnu')).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
