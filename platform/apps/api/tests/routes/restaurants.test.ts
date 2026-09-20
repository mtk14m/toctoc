import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })
// Lundi 21 septembre 2026, 10h00 à Conakry (UTC).
const NOW = new Date('2026-09-21T10:00:00.000Z')

describe('routes /restaurants — l’annuaire public', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let adminToken: string

  const admin = (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${adminToken}` } })

  const addRestaurant = async (overrides: Record<string, unknown> = {}) => {
    const res = await admin('POST', '/admin/partners', {
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      phone: '622000000',
      address: 'Almamya, derrière la pharmacie',
      city: 'Conakry',
      description: 'Cuisine guinéenne du quotidien',
      tags: ['riz gras'],
      ...overrides,
    })
    return res.json().data.partner.id as string
  }

  const addDish = (partnerId: string, name: string, availableDate = '2026-09-21') =>
    admin('POST', `/admin/partners/${partnerId}/menu-items`, { name, price: 25000, availableDate })

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, { ...deps, now: () => NOW })
    const ops = await deps.userStore.create({ phone: '+224620000000', name: 'Ops TocToc' })
    ops.role = 'ADMIN_PLATFORM'
    adminToken = app.jwt.sign({ sub: ops.id, role: ops.role })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /restaurants', () => {
    it('est public : aucun jeton requis, et la liste est vide au départ', async () => {
      const res = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ success: true, data: { restaurants: [] } })
    })

    it('liste les restaurants avec leur menu du jour et leur disponibilité', async () => {
      const id = await addRestaurant()
      await addDish(id, 'Riz gras')

      const res = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(res.json().data.restaurants).toEqual([
        {
          id,
          name: 'Chez Aïssatou',
          type: 'CUISINE_MAISON',
          city: 'Conakry',
          description: 'Cuisine guinéenne du quotidien',
          logoUrl: null,
          coverUrl: null,
          tags: ['riz gras'],
          hours: { start: '09:00', end: '24:00' },
          rating: null,
          todaysMenu: { count: 1, preview: [{ name: 'Riz gras', price: 25000 }] },
          availability: { available: true },
        },
      ])
    })

    it('n’expose ni téléphone, ni adresse, ni commission', async () => {
      const id = await addRestaurant({ commissionRate: 0.12 })
      await addDish(id, 'Riz gras')

      const res = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(res.body).not.toContain('+224622000000')
      expect(res.body).not.toContain('Almamya')
      expect(res.body).not.toContain('commission')
    })

    it('est mis en cache 30 secondes : une page légère, ça compte en 3G', async () => {
      const res = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(res.headers['cache-control']).toBe('public, max-age=30')
    })

    it('cache un restaurant désactivé par l’équipe', async () => {
      const id = await addRestaurant()
      await admin('PATCH', `/admin/partners/${id}`, { active: false })

      const res = await app.inject({ method: 'GET', url: '/restaurants' })

      expect(res.json().data.restaurants).toEqual([])
    })
  })

  describe('GET /restaurants/:id', () => {
    it('renvoie la fiche avec le menu complet du jour, sans jeton', async () => {
      const id = await addRestaurant()
      await addDish(id, 'Riz gras')
      await addDish(id, 'Plat de demain', '2026-09-22')

      const res = await app.inject({ method: 'GET', url: `/restaurants/${id}` })

      expect(res.statusCode).toBe(200)
      const { restaurant } = res.json().data
      expect(restaurant).toMatchObject({
        id,
        name: 'Chez Aïssatou',
        availability: { available: true },
      })
      expect(restaurant.menu.map((dish: { name: string }) => dish.name)).toEqual(['Riz gras'])
      expect(res.headers['cache-control']).toBe('public, max-age=30')
    })

    it('répond 404 PARTNER_NOT_FOUND pour un restaurant inconnu ou désactivé', async () => {
      const id = await addRestaurant()
      await admin('PATCH', `/admin/partners/${id}`, { active: false })

      const inactive = await app.inject({ method: 'GET', url: `/restaurants/${id}` })
      const unknown = await app.inject({ method: 'GET', url: '/restaurants/inconnu' })

      expect(inactive.statusCode).toBe(404)
      expect(inactive.json().error.code).toBe('PARTNER_NOT_FOUND')
      expect(unknown.statusCode).toBe(404)
    })
  })

  it('l’ancienne liste réservée aux connectés n’existe plus (elle est remplacée par /restaurants)', async () => {
    const res = await app.inject({ method: 'GET', url: '/partners' })

    expect(res.statusCode).toBe(404)
  })
})
