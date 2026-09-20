import { createContext, use, type ReactNode } from 'react'
import type { ApiClient } from './client'

const ApiContext = createContext<ApiClient | null>(null)

/** Donne le client d'API à tout l'arbre : les tests y glissent un faux client, sans réseau. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>
}

export function useApi(): ApiClient {
  const client = use(ApiContext)
  if (!client) throw new Error('useApi doit être utilisé dans un <ApiProvider>')
  return client
}
