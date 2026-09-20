import { beforeEach, describe, expect, it } from 'vitest'
import { createDriverService } from '../../src/services/driver.js'
import {
  InMemoryDeliveryStore,
  InMemoryGroupOrderStore,
  InMemoryUserStore,
} from '../helpers/fakes.js'

describe('DriverService — les comptes livreurs', () => {
  let users: InMemoryUserStore
  let store: InMemoryDeliveryStore
  let service: ReturnType<typeof createDriverService>

  beforeEach(() => {
    users = new InMemoryUserStore()
    store = new InMemoryDeliveryStore(new InMemoryGroupOrderStore(users), users)
    service = createDriverService({ store, defaultCountryCode: '224' })
  })

  describe('createDriver', () => {
    it('crée le compte avec le rôle livreur et la fiche livreur, numéro normalisé', async () => {
      const driver = await service.createDriver({ phone: '623 00 00 00', name: 'Ibrahima' })

      expect(driver).toEqual({
        id: expect.any(String),
        userId: expect.any(String),
        name: 'Ibrahima',
        phone: '+224623000000',
        active: true,
      })
      expect(users.users.find((u) => u.phone === '+224623000000')).toMatchObject({ role: 'DRIVER' })
    })

    it('promeut un compte client existant sans changer son nom', async () => {
      await users.create({ phone: '+224623000000', name: 'Ibrahima Diallo' })

      const driver = await service.createDriver({ phone: '623000000', name: 'Autre nom' })

      expect(driver.name).toBe('Ibrahima Diallo')
      expect(users.users).toHaveLength(1)
      expect(users.users[0]).toMatchObject({ role: 'DRIVER' })
    })

    it('est idempotent : le même numéro renvoie le même livreur', async () => {
      const first = await service.createDriver({ phone: '623000000', name: 'Ibrahima' })
      const again = await service.createDriver({ phone: '623 00 00 00', name: 'Ibrahima' })

      expect(again.id).toBe(first.id)
      expect(store.drivers).toHaveLength(1)
    })

    it('refuse un numéro qui appartient à l’équipe (409 PHONE_IN_USE), sans le rétrograder', async () => {
      const admin = await users.create({ phone: '+224620000000', name: 'Ops TocToc' })
      admin.role = 'ADMIN_PLATFORM'

      await expect(service.createDriver({ phone: '620000000', name: 'Ops' })).rejects.toMatchObject(
        {
          statusCode: 409,
          code: 'PHONE_IN_USE',
        },
      )
      expect(admin.role).toBe('ADMIN_PLATFORM')
      expect(store.drivers).toHaveLength(0)
    })

    it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
      await expect(service.createDriver({ phone: '12', name: 'Ibrahima' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PHONE',
      })
    })
  })

  describe('listDrivers', () => {
    it('liste les livreurs, les actifs d’abord, par ordre alphabétique', async () => {
      await service.createDriver({ phone: '623000001', name: 'Sékou' })
      await service.createDriver({ phone: '623000002', name: 'Ibrahima' })
      const inactive = await service.createDriver({ phone: '623000003', name: 'Aliou' })
      store.drivers.find((d) => d.id === inactive.id)!.active = false

      const drivers = await service.listDrivers()

      expect(drivers.map((d) => `${d.name}${d.active ? '' : ' (inactif)'}`)).toEqual([
        'Ibrahima',
        'Sékou',
        'Aliou (inactif)',
      ])
    })
  })
})
