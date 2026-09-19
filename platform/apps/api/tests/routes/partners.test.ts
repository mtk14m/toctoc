import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })

describe('routes partenaires et menu', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let adminToken: string
  let clientToken: string

  const validPartner = () => ({
    name: 'Chez Aïssatou',
    type: 'CUISINE_MAISON',
    phone: '621000000',
    address: 'Almamya, Conakry',
    city: 'Conakry',
  })

  const validMenuItem = () => ({ name: 'Riz gras', price: 25000, availableDate: '2026-09-22' })

  const post = (url: string, payload: unknown, token: string | null) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
    })

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, deps)

    const admin = await deps.userStore.create({ phone: '+224620000000', name: 'Ops TocToc' })
    admin.role = 'ADMIN_PLATFORM'
    adminToken = app.jwt.sign({ sub: admin.id, role: admin.role })

    const client = await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' })
    clientToken = app.jwt.sign({ sub: client.id, role: client.role })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('garde ADMIN_PLATFORM (/admin/*)', () => {
    it('refuse sans jeton (401 UNAUTHORIZED)', async () => {
      const res = await post('/admin/partners', validPartner(), null)

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it('refuse un client (403 FORBIDDEN)', async () => {
      const res = await post('/admin/partners', validPartner(), clientToken)

      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
      expect(deps.partnerStore.partners).toHaveLength(0)
    })

    it('se fie au rôle en base, pas à celui écrit dans le jeton (admin rétrogradé)', async () => {
      const demoted = await deps.userStore.create({ phone: '+224622000000', name: 'Ancien admin' })
      const staleToken = app.jwt.sign({ sub: demoted.id, role: 'ADMIN_PLATFORM' })

      const res = await post('/admin/partners', validPartner(), staleToken)

      expect(res.statusCode).toBe(403)
    })

    it('refuse un admin dont le compte a été désactivé (401)', async () => {
      const [admin] = deps.userStore.users
      admin!.isActive = false

      const res = await post('/admin/partners', validPartner(), adminToken)

      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /admin/partners', () => {
    it('crée le partenaire (201) avec le téléphone normalisé', async () => {
      const res = await post('/admin/partners', validPartner(), adminToken)

      expect(res.statusCode).toBe(201)
      expect(res.json().data.partner).toMatchObject({
        id: expect.any(String),
        name: 'Chez Aïssatou',
        type: 'CUISINE_MAISON',
        phone: '+224621000000',
        active: true,
      })
    })

    it('accepte un taux de commission négocié', async () => {
      const res = await post(
        '/admin/partners',
        { ...validPartner(), commissionRate: 0.145 },
        adminToken,
      )

      expect(res.statusCode).toBe(201)
      expect(res.json().data.partner.commissionRate).toBe(0.145)
    })

    it('sert de 9h à minuit par défaut', async () => {
      const res = await post('/admin/partners', validPartner(), adminToken)

      expect(res.json().data.partner).toMatchObject({ serviceStart: '09:00', serviceEnd: '24:00' })
    })

    it('accepte des heures de service réduites (une cuisinière qui ne fait que le déjeuner)', async () => {
      const res = await post(
        '/admin/partners',
        { ...validPartner(), serviceStart: '11:00', serviceEnd: '15:00' },
        adminToken,
      )

      expect(res.statusCode).toBe(201)
      expect(res.json().data.partner).toMatchObject({ serviceStart: '11:00', serviceEnd: '15:00' })
    })

    it.each([
      ['un format qui n’est pas HH:mm', { serviceStart: '9h' }],
      ['une heure qui n’existe pas', { serviceEnd: '25:00' }],
      ['un début égal à la fin', { serviceStart: '12:00', serviceEnd: '12:00' }],
      ['un début après la fin', { serviceStart: '15:00', serviceEnd: '11:00' }],
      ['une fin avant le début par défaut (9h)', { serviceEnd: '08:00' }],
    ])('refuse %s (400 VALIDATION_ERROR)', async (_label, hours) => {
      const res = await post('/admin/partners', { ...validPartner(), ...hours }, adminToken)

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it.each([
      ['un nom vide', { name: '  ' }],
      ['un type inconnu', { type: 'FOODTRUCK' }],
      ['un taux supérieur à 1', { commissionRate: 1.5 }],
      ['un taux négatif', { commissionRate: -0.1 }],
      [
        'un taux à plus de 4 décimales (le calcul se fait en points de base)',
        { commissionRate: 0.12345 },
      ],
    ])('refuse %s (400 VALIDATION_ERROR)', async (_label, override) => {
      const res = await post('/admin/partners', { ...validPartner(), ...override }, adminToken)

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
      const res = await post('/admin/partners', { ...validPartner(), phone: '12' }, adminToken)

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('INVALID_PHONE')
    })
  })

  describe('POST /admin/partners/:partnerId/menu-items', () => {
    let partnerId: string

    beforeEach(async () => {
      const res = await post('/admin/partners', validPartner(), adminToken)
      partnerId = res.json().data.partner.id
    })

    const url = () => `/admin/partners/${partnerId}/menu-items`

    it('ajoute le plat du jour (201)', async () => {
      const res = await post(url(), validMenuItem(), adminToken)

      expect(res.statusCode).toBe(201)
      expect(res.json().data.menuItem).toEqual({
        id: expect.any(String),
        partnerId,
        name: 'Riz gras',
        description: null,
        price: 25000,
        photoUrl: null,
        availableDate: '2026-09-22',
      })
    })

    it('refuse un client (403 FORBIDDEN)', async () => {
      const res = await post(url(), validMenuItem(), clientToken)

      expect(res.statusCode).toBe(403)
    })

    it('répond 404 pour un partenaire inconnu', async () => {
      const res = await post('/admin/partners/inconnu/menu-items', validMenuItem(), adminToken)

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('PARTNER_NOT_FOUND')
    })

    it.each([
      ['un prix nul', { price: 0 }],
      ['un prix avec des décimales (le GNF n’en a pas)', { price: 12.5 }],
      ['un prix négatif', { price: -100 }],
      ['une date qui n’est pas AAAA-MM-JJ', { availableDate: '22/09/2026' }],
      ['une date inexistante', { availableDate: '2026-02-30' }],
      ['une photo qui n’est pas une URL http(s)', { photoUrl: 'javascript:alert(1)' }],
    ])('refuse %s (400 VALIDATION_ERROR)', async (_label, override) => {
      const res = await post(url(), { ...validMenuItem(), ...override }, adminToken)

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /partners', () => {
    it('exige un jeton (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/partners' })

      expect(res.statusCode).toBe(401)
    })

    it('liste les partenaires actifs pour un relais, sans données internes', async () => {
      await post('/admin/partners', validPartner(), adminToken)

      const res = await app.inject({
        method: 'GET',
        url: '/partners',
        headers: { authorization: `Bearer ${clientToken}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.partners).toEqual([
        { id: expect.any(String), name: 'Chez Aïssatou', type: 'CUISINE_MAISON', city: 'Conakry' },
      ])
      expect(res.body).not.toContain('+224621000000')
      expect(res.body).not.toContain('commissionRate')
    })
  })
})
