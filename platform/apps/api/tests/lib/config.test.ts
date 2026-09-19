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
      expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }).jwtSecret).toBe(
        'x'.repeat(32),
      )
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

  it('lit DATABASE_URL et refuse une valeur qui n’est pas une URL', () => {
    const url = 'postgresql://user:pass@db.example:5432/toctoc'

    expect(loadConfig({ DATABASE_URL: url }).databaseUrl).toBe(url)
    expect(() => loadConfig({ DATABASE_URL: 'pas-une-url' })).toThrow(/DATABASE_URL/)
  })
})
