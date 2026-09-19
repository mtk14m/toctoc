import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createTestDeps } from '../helpers/fakes.js'
import { AppError } from '../../src/lib/errors.js'

describe('gestion des erreurs', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test' }), createTestDeps())

    app.get('/_test/app-error', async () => {
      throw new AppError(409, 'GROUP_ORDER_CLOSED', 'Ce lien est fermé')
    })
    app.get('/_test/zod-error', async () => {
      z.object({ phone: z.string().min(8) }).parse({ phone: '12' })
    })
    app.get('/_test/crash', async () => {
      throw new Error('détail interne : mot de passe de la base = hunter2')
    })
    app.post('/_test/echo', async (req) => req.body)

    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('route inconnue → 404 NOT_FOUND dans l’enveloppe d’erreur', async () => {
    const res = await app.inject({ method: 'GET', url: '/nexiste-pas' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    })
  })

  it('AppError → son statut, son code et son message', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/app-error' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      success: false,
      error: { code: 'GROUP_ORDER_CLOSED', message: 'Ce lien est fermé' },
    })
  })

  it('ZodError → 400 VALIDATION_ERROR avec le détail des champs', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/zod-error' })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toEqual([expect.objectContaining({ path: ['phone'] })])
  })

  it('corps JSON invalide → 400 (erreur client de Fastify, pas un 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/_test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ pas du json',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, error: { code: expect.any(String) } })
  })

  it('erreur inattendue → 500 INTERNAL_ERROR sans fuite du message interne', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/crash' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' },
    })
    expect(res.body).not.toContain('hunter2')
  })
})
