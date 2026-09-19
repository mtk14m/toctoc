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

  describe('listActivePartners', () => {
    it('ne renvoie que ce dont un relais a besoin pour choisir (ni téléphone ni commission)', async () => {
      await service.createPartner(validPartner())

      const partners = await service.listActivePartners()

      expect(partners).toEqual([
        { id: expect.any(String), name: 'Chez Aïssatou', type: 'CUISINE_MAISON', city: 'Conakry' },
      ])
    })

    it('n’inclut pas les partenaires désactivés', async () => {
      await service.createPartner(validPartner())
      store.partners[0]!.active = false

      expect(await service.listActivePartners()).toEqual([])
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
