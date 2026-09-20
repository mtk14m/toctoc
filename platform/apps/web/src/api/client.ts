/**
 * Le client HTTP de l'API TocToc. Toutes les réponses ont la même enveloppe :
 * `{ success: true, data }` ou `{ success: false, error: { code, message, details? } }`.
 * Ici on ne garde que `data`, et toute erreur devient une `ApiError` que les écrans savent lire.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  /** Le jeton de connexion (équipe, livreur), lu à chaque appel : il peut changer en cours de route. */
  getToken?: () => string | null
}

export interface RequestOptions {
  signal?: AbortSignal
}

type Envelope =
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string; details?: unknown } }

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || !('success' in value)) return false
  if (value.success === true) return 'data' in value
  if (value.success !== false || !('error' in value)) return false
  const { error } = value
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    { signal }: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    const token = options.getToken?.()
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'

    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
        ...(signal && { signal }),
      })
    } catch (error) {
      // Une requête annulée (l'écran a changé) n'est pas une panne : on la laisse remonter telle quelle.
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'Pas de connexion. Vérifiez votre réseau et réessayez.',
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }

    if (!isEnvelope(payload)) {
      throw new ApiError(response.status, 'BAD_RESPONSE', 'Réponse inattendue du serveur.')
    }
    if (!payload.success) {
      const { code, message, details } = payload.error
      throw new ApiError(response.status, code, message, details)
    }
    return payload.data as T
  }

  return {
    get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('POST', path, body ?? undefined, options),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('PATCH', path, body ?? undefined, options),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
