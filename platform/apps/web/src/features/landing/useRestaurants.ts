import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { listRestaurants } from '../../api/restaurants'
import type { RestaurantCard } from '../../api/types'

const GENERIC_ERROR = 'Impossible de charger les restaurants pour le moment.'

export type RestaurantsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; restaurants: RestaurantCard[] }

/** Charge l'annuaire, l'annule quand l'écran disparaît, et permet de réessayer. */
export function useRestaurants() {
  const api = useApi()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RestaurantsState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    listRestaurants(api, { signal: controller.signal }).then(
      (restaurants) => {
        if (!controller.signal.aborted) setState({ status: 'success', restaurants })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // On ne montre que les messages qu'on a écrits pour les gens ; le reste reste générique.
        setState({
          status: 'error',
          message: error instanceof ApiError ? error.message : GENERIC_ERROR,
        })
      },
    )
    return () => controller.abort()
  }, [api, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
