import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { MAX_OTP_REQUESTS } from '../../src/services/otp.js'
import { createTestDeps } from '../helpers/fakes.js'

const config = loadConfig({ NODE_ENV: 'test' })

describe('routes /auth', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>

  beforeEach(async () => {
    await app?.close()
    deps = createTestDeps()
    app = await buildApp(config, deps)
  })

  afterAll(async () => {
    await app.close()
  })

  const requestOtp = (phone: string) =>
    app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } })

  const verifyOtp = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/auth/otp/verify', payload })

  describe('POST /auth/otp/request', () => {
    it('envoie un code au numéro normalisé (+224) et répond 200', async () => {
      const res = await requestOtp('621 00 00 00')

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ success: true, data: { message: 'Code envoyé' } })
      expect(deps.otpSender.last.phone).toBe('+224621000000')
      expect(deps.otpSender.last.code).toMatch(/^\d{6}$/)
    })

    it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
      const res = await requestOtp('12')

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('INVALID_PHONE')
      expect(deps.otpSender.sent).toHaveLength(0)
    })

    it('refuse un corps sans téléphone (400 VALIDATION_ERROR)', async () => {
      const res = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: {} })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('limite les demandes par numéro (429)', async () => {
      for (let i = 0; i < MAX_OTP_REQUESTS; i++) {
        expect((await requestOtp('621000000')).statusCode).toBe(200)
      }

      const res = await requestOtp('621000000')

      expect(res.statusCode).toBe(429)
      expect(res.json().error.code).toBe('RATE_LIMIT_EXCEEDED')
    })

    it('répond de la même façon que le numéro soit déjà inscrit ou non', async () => {
      await deps.userStore.create({ phone: '+224621000000', name: 'Aïcha' })

      const known = await requestOtp('621000000')
      const unknown = await requestOtp('622000000')

      expect(known.statusCode).toBe(unknown.statusCode)
      expect(known.body).toBe(unknown.body)
    })
  })

  describe('POST /auth/otp/verify', () => {
    it('crée le compte, renvoie un jeton et l’utilisateur (parcours du nouveau relais)', async () => {
      await requestOtp('621000000')

      const res = await verifyOtp({
        phone: '621000000',
        code: deps.otpSender.last.code,
        name: 'Aïcha Diallo',
      })

      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data.isNew).toBe(true)
      expect(data.accessToken).toEqual(expect.any(String))
      expect(data.user).toEqual({
        id: expect.any(String),
        phone: '+224621000000',
        name: 'Aïcha Diallo',
        role: 'CLIENT',
      })
    })

    it('ne renvoie aucun champ interne dans l’utilisateur', async () => {
      await requestOtp('621000000')

      const res = await verifyOtp({
        phone: '621000000',
        code: deps.otpSender.last.code,
        name: 'Aïcha',
      })

      expect(Object.keys(res.json().data.user).sort()).toEqual(['id', 'name', 'phone', 'role'])
      expect(res.body).not.toContain('codeHash')
    })

    it('reconnecte un utilisateur existant sans demander le nom', async () => {
      await deps.userStore.create({ phone: '+224621000000', name: 'Aïcha' })
      await requestOtp('621000000')

      const res = await verifyOtp({ phone: '621000000', code: deps.otpSender.last.code })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.isNew).toBe(false)
    })

    it('demande le nom à un nouvel utilisateur (422 NAME_REQUIRED)', async () => {
      await requestOtp('621000000')

      const res = await verifyOtp({ phone: '621000000', code: deps.otpSender.last.code })

      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe('NAME_REQUIRED')
    })

    it('refuse un mauvais code (401 INVALID_OTP)', async () => {
      await requestOtp('621000000')

      const res = await verifyOtp({ phone: '621000000', code: '000000', name: 'Aïcha' })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('INVALID_OTP')
    })

    it('refuse un code qui n’a pas 6 chiffres (400 VALIDATION_ERROR)', async () => {
      const res = await verifyOtp({ phone: '621000000', code: '12ab' })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /auth/me', () => {
    async function login() {
      await requestOtp('621000000')
      const res = await verifyOtp({
        phone: '621000000',
        code: deps.otpSender.last.code,
        name: 'Aïcha',
      })
      return res.json().data as { accessToken: string; user: { id: string } }
    }

    it('renvoie l’utilisateur du jeton', async () => {
      const { accessToken, user } = await login()

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.user).toMatchObject({ id: user.id, name: 'Aïcha' })
    })

    it('refuse sans jeton (401 UNAUTHORIZED, dans l’enveloppe d’erreur)', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/me' })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({
        success: false,
        error: { code: 'UNAUTHORIZED', message: expect.any(String) },
      })
    })

    it('refuse un jeton falsifié', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: 'Bearer pas.un.vrai.jeton' },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it('refuse le jeton d’un compte désactivé depuis sa connexion', async () => {
      const { accessToken, user } = await login()
      const stored = await deps.userStore.findById(user.id)
      stored!.isActive = false

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      })

      expect(res.statusCode).toBe(401)
    })
  })
})
