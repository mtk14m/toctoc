import type { ApiClient, RequestOptions } from './client'
import type { RestaurantCard } from './types'

/** L'annuaire public : ceux qu'on peut commander maintenant d'abord, puis les mieux notés. */
export async function listRestaurants(
  api: ApiClient,
  options?: RequestOptions,
): Promise<RestaurantCard[]> {
  const { restaurants } = await api.get<{ restaurants: RestaurantCard[] }>('/restaurants', options)
  return restaurants
}
