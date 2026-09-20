import { beforeEach, describe, expect, it } from 'vitest'
import { createPartnerService } from '../../src/services/partner.js'
import { InMemoryPartnerStore } from '../helpers/fakes.js'

const validPartner = () => ({
  name: 'Chez Aïssatou',
  type: 'CUISINE_MAISON' as const,
  phone: '621 00 00 00',
  address: 'Almamya, Conakry',
  city: 'Conakry',
})

describe('PartnerService', () => {
  let store: InMemoryPartnerStore
  let service: ReturnType<typeof createPartnerService>

  beforeEach(() => {
    store = new InMemoryPartnerStore()
    service = createPartnerService({ store, defaultCountryCode: '224' })
  })

  describe('createPartner', () => {
    it('crée un partenaire actif avec le téléphone normalisé (+224)', async () => {
      const partner = await service.createPartner(validPartner())

      expect(partner).toMatchObject({
        id: expect.any(String),
        name: 'Chez Aïssatou',
        type: 'CUISINE_MAISON',
        phone: '+224621000000',
        city: 'Conakry',
        active: true,
      })
    })

    it('sert de 9h à minuit par défaut, et enregistre des heures réduites en minutes', async () => {
      const usual = await service.createPartner(validPartner())
      const lunchOnly = await service.createPartner({
        ...validPartner(),
        serviceStartMinute: 660,
        serviceEndMinute: 900,
      })

      expect(usual).toMatchObject({ serviceStartMinute: 540, serviceEndMinute: 1440 })
      expect(lunchOnly).toMatchObject({ serviceStartMinute: 660, serviceEndMinute: 900 })
    })

    it('enregistre le taux de commission négocié', async () => {
      const partner = await service.createPartner({ ...validPartner(), commissionRate: 0.12 })

      expect(partner.commissionRate).toBe(0.12)
    })

    it('refuse un numéro de téléphone invalide (400 INVALID_PHONE)', async () => {
      await expect(service.createPartner({ ...validPartner(), phone: '12' })).rejects.toMatchObject(
        { statusCode: 400, code: 'INVALID_PHONE' },
      )
      expect(store.partners).toHaveLength(0)
    })
  })

  describe('présentation dans l’annuaire', () => {
    it('enregistre la description, le logo, la couverture et les spécialités', async () => {
      const partner = await service.createPartner({
        ...validPartner(),
        description: 'Cuisine faite maison',
        logoUrl: 'https://cdn.example.com/logo.png',
        coverUrl: 'https://cdn.example.com/cover.jpg',
        tags: ['riz gras', 'poulet braisé'],
      })

      expect(partner).toMatchObject({
        description: 'Cuisine faite maison',
        logoUrl: 'https://cdn.example.com/logo.png',
        coverUrl: 'https://cdn.example.com/cover.jpg',
        tags: ['riz gras', 'poulet braisé'],
      })
    })

    it('n’a ni description ni image ni spécialité par défaut', async () => {
      const partner = await service.createPartner(validPartner())

      expect(partner).toMatchObject({ description: null, logoUrl: null, coverUrl: null, tags: [] })
    })
  })

  describe('updatePartner', () => {
    let partnerId: string

    beforeEach(async () => {
      partnerId = (await service.createPartner(validPartner())).id
    })

    it('met à jour la présentation, les heures et l’activité, sans toucher au reste', async () => {
      const updated = await service.updatePartner(partnerId, {
        description: 'Nouvelle description',
        tags: ['attiéké'],
        serviceStartMinute: 660,
        serviceEndMinute: 900,
        active: false,
      })

      expect(updated).toMatchObject({
        name: 'Chez Aïssatou',
        phone: '+224621000000',
        description: 'Nouvelle description',
        tags: ['attiéké'],
        serviceStartMinute: 660,
        serviceEndMinute: 900,
        active: false,
      })
    })

    it('efface la description ou une image avec null', async () => {
      await service.updatePartner(partnerId, {
        description: 'À effacer',
        logoUrl: 'https://cdn.example.com/a.png',
      })

      const cleared = await service.updatePartner(partnerId, { description: null, logoUrl: null })

      expect(cleared).toMatchObject({ description: null, logoUrl: null })
    })

    it('répond 404 PARTNER_NOT_FOUND pour un restaurant inconnu', async () => {
      await expect(service.updatePartner('inconnu', { active: false })).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARTNER_NOT_FOUND',
      })
    })

    it('refuse des heures incohérentes avec celles déjà enregistrées (422 INVALID_SERVICE_HOURS)', async () => {
      await service.updatePartner(partnerId, { serviceStartMinute: 660, serviceEndMinute: 900 })

      // début 20h00 alors que la fin enregistrée est 15h00
      await expect(
        service.updatePartner(partnerId, { serviceStartMinute: 1200 }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_SERVICE_HOURS' })
      expect(store.partners[0]).toMatchObject({ serviceStartMinute: 660 })
    })
  })

  describe('addMenuItem', () => {
    let partnerId: string

    beforeEach(async () => {
      partnerId = (await service.createPartner(validPartner())).id
    })

    it('ajoute un plat pour un jour donné et renvoie la date en AAAA-MM-JJ', async () => {
      const item = await service.addMenuItem(partnerId, {
        name: 'Riz gras',
        price: 25000,
        availableDate: new Date('2026-09-22'),
      })

      expect(item).toEqual({
        id: expect.any(String),
        partnerId,
        name: 'Riz gras',
        description: null,
        price: 25000,
        photoUrl: null,
        availableDate: '2026-09-22',
      })
    })

    it('enregistre la description et la photo quand elles sont données', async () => {
      const item = await service.addMenuItem(partnerId, {
        name: 'Attiéké poisson',
        description: 'Poisson braisé, oignons, piment',
        price: 30000,
        photoUrl: 'https://cdn.example.com/attieke.jpg',
        availableDate: new Date('2026-09-22'),
      })

      expect(item.description).toBe('Poisson braisé, oignons, piment')
      expect(item.photoUrl).toBe('https://cdn.example.com/attieke.jpg')
    })

    it('refuse un partenaire inconnu (404 PARTNER_NOT_FOUND)', async () => {
      await expect(
        service.addMenuItem('inconnu', {
          name: 'Riz gras',
          price: 25000,
          availableDate: new Date('2026-09-22'),
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'PARTNER_NOT_FOUND' })
      expect(store.menuItems).toHaveLength(0)
    })
  })
})
