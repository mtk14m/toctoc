import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/lib/config.js'

describe('loadConfig', () => {
  it('applique des valeurs par défaut de développement quand rien n’est défini', () => {
    const config = loadConfig({})

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      redisUrl: 'redis://localhost:6380',
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
})
