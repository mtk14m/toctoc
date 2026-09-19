import { beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors.js'
import {
  MAX_OTP_ATTEMPTS,
  MAX_OTP_REQUESTS,
  OTP_TTL_MS,
  createOtpService,
  generateOtpCode,
} from '../../src/services/otp.js'
import { InMemoryOtpStore, InMemoryRateLimiter, RecordingOtpSender } from '../helpers/fakes.js'

const PHONE = '+224621000000'
const CODE = '123456'

describe('generateOtpCode', () => {
  it('produit toujours 6 chiffres, zéros initiaux compris', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/)
    }
  })

  it('ne renvoie pas toujours la même valeur', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()))

    expect(codes.size).toBeGreaterThan(40)
  })
})

describe('OtpService', () => {
  let store: InMemoryOtpStore
  let sender: RecordingOtpSender
  let rateLimiter: InMemoryRateLimiter
  let currentTime: Date
  let otp: ReturnType<typeof createOtpService>

  beforeEach(() => {
    store = new InMemoryOtpStore()
    sender = new RecordingOtpSender()
    rateLimiter = new InMemoryRateLimiter()
    currentTime = new Date('2026-09-19T10:00:00Z')
    otp = createOtpService({
      store,
      sender,
      rateLimiter,
      secret: 'secret-de-test-secret-de-test-1234',
      now: () => currentTime,
      generateCode: () => CODE,
    })
  })

  describe('request', () => {
    it('envoie le code au numéro par le canal d’envoi', async () => {
      await otp.request(PHONE)

      expect(sender.sent).toEqual([{ phone: PHONE, code: CODE }])
    })

    it('ne stocke jamais le code en clair', async () => {
      await otp.request(PHONE)

      const [record] = store.records
      expect(record?.codeHash).toBeDefined()
      expect(record?.codeHash).not.toContain(CODE)
      expect(JSON.stringify(store.records)).not.toContain(CODE)
    })

    it('fixe l’expiration à 5 minutes', async () => {
      await otp.request(PHONE)

      expect(store.records[0]?.expiresAt.getTime()).toBe(currentTime.getTime() + OTP_TTL_MS)
      expect(OTP_TTL_MS).toBe(5 * 60 * 1000)
    })

    it('invalide le code précédent quand on en demande un nouveau', async () => {
      await otp.request(PHONE)
      const firstCode = sender.last.code
      const secondOtp = createOtpService({
        store,
        sender,
        rateLimiter,
        secret: 'secret-de-test-secret-de-test-1234',
        now: () => currentTime,
        generateCode: () => '654321',
      })

      await secondOtp.request(PHONE)

      await expect(secondOtp.check(PHONE, firstCode)).rejects.toMatchObject({ code: 'INVALID_OTP' })
      await expect(secondOtp.check(PHONE, '654321')).resolves.toBeDefined()
    })

    it(`refuse au-delà de ${MAX_OTP_REQUESTS} demandes dans la fenêtre, sans rien envoyer`, async () => {
      for (let i = 0; i < MAX_OTP_REQUESTS; i++) await otp.request(PHONE)
      const sentBefore = sender.sent.length

      await expect(otp.request(PHONE)).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      })
      expect(sender.sent).toHaveLength(sentBefore)
    })

    it('compte les demandes par numéro, pas globalement', async () => {
      for (let i = 0; i < MAX_OTP_REQUESTS; i++) await otp.request(PHONE)

      await expect(otp.request('+224622000000')).resolves.toBeUndefined()
    })

    it('signale un échec d’envoi par une erreur dédiée', async () => {
      sender.failWith = new Error('WhatsApp indisponible')

      await expect(otp.request(PHONE)).rejects.toMatchObject({
        statusCode: 502,
        code: 'OTP_DELIVERY_FAILED',
      })
    })
  })

  describe('check', () => {
    beforeEach(async () => {
      await otp.request(PHONE)
    })

    it('accepte le bon code', async () => {
      await expect(otp.check(PHONE, CODE)).resolves.toMatchObject({ id: expect.any(String) })
    })

    it('ne consomme pas le code (on peut vérifier puis finaliser)', async () => {
      await otp.check(PHONE, CODE)

      await expect(otp.check(PHONE, CODE)).resolves.toBeDefined()
    })

    it('refuse un mauvais code avec INVALID_OTP (401)', async () => {
      await expect(otp.check(PHONE, '000000')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_OTP',
      })
    })

    it('refuse un code expiré', async () => {
      currentTime = new Date(currentTime.getTime() + OTP_TTL_MS + 1)

      await expect(otp.check(PHONE, CODE)).rejects.toMatchObject({ code: 'INVALID_OTP' })
    })

    it('répond pareil pour un numéro inconnu et pour un mauvais code (pas d’énumération)', async () => {
      const wrongCode = await otp.check(PHONE, '000000').catch((e: AppError) => e)
      const unknownPhone = await otp.check('+224699999999', CODE).catch((e: AppError) => e)

      expect(unknownPhone).toBeInstanceOf(AppError)
      expect((unknownPhone as AppError).code).toBe((wrongCode as AppError).code)
      expect((unknownPhone as AppError).message).toBe((wrongCode as AppError).message)
    })

    it(`bloque le code après ${MAX_OTP_ATTEMPTS} essais ratés, même avec le bon code ensuite`, async () => {
      for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
        await expect(otp.check(PHONE, '000000')).rejects.toMatchObject({ code: 'INVALID_OTP' })
      }

      await expect(otp.check(PHONE, CODE)).rejects.toMatchObject({ code: 'INVALID_OTP' })
    })
  })

  describe('consume', () => {
    it('ne peut servir qu’une seule fois', async () => {
      await otp.request(PHONE)
      const record = await otp.check(PHONE, CODE)

      await otp.consume(record)

      await expect(otp.consume(record)).rejects.toMatchObject({ code: 'INVALID_OTP' })
      await expect(otp.check(PHONE, CODE)).rejects.toMatchObject({ code: 'INVALID_OTP' })
    })

    it('deux consommations simultanées : une seule réussit', async () => {
      await otp.request(PHONE)
      const record = await otp.check(PHONE, CODE)

      const results = await Promise.allSettled([otp.consume(record), otp.consume(record)])

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    })
  })
})
