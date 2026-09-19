import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'

describe('GET /health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test' }))
  })

  afterAll(async () => {
    await app.close()
  })

  it('répond 200 avec l’enveloppe { success, data }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('ok')
    expect(new Date(body.data.timestamp).toString()).not.toBe('Invalid Date')
  })

  it('renvoie les en-têtes de sécurité helmet', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('autorise l’origine CORS configurée et refuse les autres', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    })
    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})
