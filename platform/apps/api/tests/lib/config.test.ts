import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/lib/config.js'

describe('loadConfig', () => {
  it('applique des valeurs par défaut de développement quand rien n’est défini', () => {
    const config = loadConfig({})

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      redisUrl: 'redis://localhost:6380',
      databaseUrl: 'postgresql://toctoc:toctoc@localhost:5433/toctoc',
      corsOrigins: ['http://localhost:5173'],
    })
  })

  it('convertit PORT en nombre', () => {
    expect(loadConfig({ PORT: '4100' }).port).toBe(4100)
  })

  it('découpe CORS_ORIGIN sur les virgules et ignore les espaces', () => {
    const config = loadConfig({ CORS_ORIGIN: 'https://toctoc.app, https://www.toctoc.app ,' })

    expect(config.corsOrigins).toEqual(['https://toctoc.app', 'https://www.toctoc.app'])
  })

  it('refuse un PORT invalide (échec au démarrage plutôt qu’un comportement flou)', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('refuse un NODE_ENV inconnu', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('refuse un REDIS_URL qui n’est pas une URL', () => {
    expect(() => loadConfig({ REDIS_URL: 'pas-une-url' })).toThrow(/REDIS_URL/)
  })

  describe('JWT_SECRET', () => {
    it('a une valeur de développement par défaut hors production', () => {
      expect(loadConfig({}).jwtSecret.length).toBeGreaterThanOrEqual(32)
      expect(loadConfig({ NODE_ENV: 'test' }).jwtSecret.length).toBeGreaterThanOrEqual(32)
    })

    it('est obligatoire en production (jamais de secret par défaut en prod)', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/)
    })

    it('traite une variable vide comme non définie (cas de .env.example copié tel quel)', () => {
      expect(loadConfig({ JWT_SECRET: '' }).jwtSecret.length).toBeGreaterThanOrEqual(32)
      expect(loadConfig({ PORT: '' }).port).toBe(3000)
      // ... sans jamais fabriquer de secret par défaut en production
      expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow(/JWT_SECRET/)
    })

    it('doit faire au moins 32 caractères', () => {
      expect(() => loadConfig({ JWT_SECRET: 'trop-court' })).toThrow(/JWT_SECRET/)
      expect(
        loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'x'.repeat(32),
          PAYMENT_WEBHOOK_SECRET: 'w'.repeat(32),
        }).jwtSecret,
      ).toBe('x'.repeat(32))
    })
  })

  describe('envoi des OTP et pays par défaut', () => {
    it('envoie les OTP dans la console par défaut, avec l’indicatif de la Guinée', () => {
      const config = loadConfig({})

      expect(config.otpDelivery).toBe('console')
      expect(config.defaultCountryCode).toBe('224')
    })

    it('refuse un canal d’envoi inconnu et un indicatif invalide', () => {
      expect(() => loadConfig({ OTP_DELIVERY: 'pigeon' })).toThrow(/OTP_DELIVERY/)
      expect(() => loadConfig({ DEFAULT_COUNTRY_CODE: '+224' })).toThrow(/DEFAULT_COUNTRY_CODE/)
    })
  })

  describe('paiement', () => {
    it('utilise la passerelle de test et un secret de webhook de développement par défaut', () => {
      const config = loadConfig({})

      expect(config.paymentProvider).toBe('fake')
      expect(config.paymentWebhookSecret.length).toBeGreaterThanOrEqual(32)
    })

    it('exige un secret de webhook en production (jamais de secret par défaut en prod)', () => {
      expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) })).toThrow(
        /PAYMENT_WEBHOOK_SECRET/,
      )
      expect(
        loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'x'.repeat(32),
          PAYMENT_WEBHOOK_SECRET: 'w'.repeat(32),
        }).paymentWebhookSecret,
      ).toBe('w'.repeat(32))
    })

    it('refuse un secret trop court et un opérateur inconnu', () => {
      expect(() => loadConfig({ PAYMENT_WEBHOOK_SECRET: 'court' })).toThrow(
        /PAYMENT_WEBHOOK_SECRET/,
      )
      expect(() => loadConfig({ PAYMENT_PROVIDER: 'orange' })).toThrow(/PAYMENT_PROVIDER/)
    })
  })

  describe('PARTNER_NOTIFICATION', () => {
    it('écrit les récaps dans les logs par défaut (en attendant WhatsApp / SMS)', () => {
      expect(loadConfig({}).partnerNotification).toBe('console')
    })

    it('refuse un canal inconnu', () => {
      expect(() => loadConfig({ PARTNER_NOTIFICATION: 'pigeon' })).toThrow(/PARTNER_NOTIFICATION/)
    })
  })

  describe('TRUST_PROXY', () => {
    it('est désactivé par défaut : sans proxy, X-Forwarded-For serait falsifiable', () => {
      expect(loadConfig({}).trustProxy).toBe(false)
    })

    it('s’active explicitement (API derrière Caddy) et refuse une valeur floue', () => {
      expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true)
      expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false)
      expect(() => loadConfig({ TRUST_PROXY: 'peut-etre' })).toThrow(/TRUST_PROXY/)
    })
  })

  it('lit DATABASE_URL et refuse une valeur qui n’est pas une URL', () => {
    const url = 'postgresql://user:pass@db.example:5432/toctoc'

    expect(loadConfig({ DATABASE_URL: url }).databaseUrl).toBe(url)
    expect(() => loadConfig({ DATABASE_URL: 'pas-une-url' })).toThrow(/DATABASE_URL/)
  })
})
