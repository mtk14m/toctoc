import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('client d’API — l’enveloppe { success, data } de TocToc', () => {
  it('renvoie `data` quand la réponse est un succès', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ success: true, data: { restaurants: [] } }))
    const api = createApiClient({ baseUrl: 'http://api.test', fetch })

    await expect(api.get('/restaurants')).resolves.toEqual({ restaurants: [] })
    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/restaurants',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('tolère un « / » de trop à la fin de l’adresse de base', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ success: true, data: {} }))
    const api = createApiClient({ baseUrl: 'http://api.test/', fetch })

    await api.get('/health')

    expect(fetch.mock.calls[0]![0]).toBe('http://api.test/health')
  })

  it('envoie un corps JSON avec son en-tête, et rien sinon', async () => {
    // Une nouvelle réponse à chaque appel : le corps d'une Response ne se lit qu'une fois.
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ success: true, data: { ok: 1 } }, 201),
    )
    const api = createApiClient({ baseUrl: 'http://api.test', fetch })

    await api.post('/group-orders', { deliveryAddress: 'Kaloum' })
    await api.get('/restaurants')

    const withBody = fetch.mock.calls[0]![1]!
    expect(withBody.body).toBe('{"deliveryAddress":"Kaloum"}')
    expect(withBody.headers).toMatchObject({ 'content-type': 'application/json' })
    const withoutBody = fetch.mock.calls[1]![1]!
    expect(withoutBody.body).toBeUndefined()
    expect(withoutBody.headers).not.toHaveProperty('content-type')
  })

  it('joint le jeton de connexion quand il y en a un', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ success: true, data: {} }))
    const api = createApiClient({ baseUrl: 'http://api.test', fetch, getToken: () => 'jeton-123' })

    await api.get('/admin/refunds')

    expect(fetch.mock.calls[0]![1].headers).toMatchObject({ authorization: 'Bearer jeton-123' })
  })

  it('n’envoie aucun en-tête d’autorisation sans jeton', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ success: true, data: {} }))
    const api = createApiClient({ baseUrl: 'http://api.test', fetch, getToken: () => null })

    await api.get('/restaurants')

    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty('authorization')
  })

  describe('les erreurs', () => {
    it('transforme l’enveloppe d’erreur en ApiError, avec le code et les détails', async () => {
      const fetch = vi.fn().mockResolvedValue(
        json(
          {
            success: false,
            error: {
              code: 'TOO_LATE_TO_DELIVER',
              message: 'Trop tard',
              details: { last: '22:54' },
            },
          },
          422,
        ),
      )
      const api = createApiClient({ baseUrl: 'http://api.test', fetch })

      const error = await api.post('/group-orders', {}).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({
        status: 422,
        code: 'TOO_LATE_TO_DELIVER',
        message: 'Trop tard',
        details: { last: '22:54' },
      })
    })

    it('signale un réseau coupé (la 3G de Conakry) par un code dédié', async () => {
      const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      const api = createApiClient({ baseUrl: 'http://api.test', fetch })

      await expect(api.get('/restaurants')).rejects.toMatchObject({
        status: 0,
        code: 'NETWORK_ERROR',
      })
    })

    it('laisse passer une requête annulée telle quelle (pas une erreur réseau)', async () => {
      const abort = new DOMException('annulée', 'AbortError')
      const fetch = vi.fn().mockRejectedValue(abort)
      const api = createApiClient({ baseUrl: 'http://api.test', fetch })

      await expect(api.get('/restaurants')).rejects.toBe(abort)
    })

    it('refuse une réponse qui n’a pas la forme de l’enveloppe', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }))
        .mockResolvedValueOnce(json({ hello: 'world' }))
      const api = createApiClient({ baseUrl: 'http://api.test', fetch })

      await expect(api.get('/restaurants')).rejects.toMatchObject({
        status: 502,
        code: 'BAD_RESPONSE',
      })
      await expect(api.get('/restaurants')).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    })
  })
})
