import type { RestaurantCard } from '../api/types'

export function restaurantFixture(overrides: Partial<RestaurantCard> = {}): RestaurantCard {
  return {
    id: 'partner_1',
    name: 'Chez Aïssatou',
    type: 'CUISINE_MAISON',
    city: 'Conakry',
    description: 'Cuisine guinéenne du quotidien, mijotée le matin même.',
    logoUrl: null,
    coverUrl: null,
    tags: ['Guinéen', 'Riz'],
    hours: { start: '11:00', end: '22:30' },
    rating: { average: 4.5, count: 2 },
    todaysMenu: {
      count: 4,
      preview: [
        { name: 'Riz gras', price: 25000 },
        { name: 'Poulet braisé', price: 35000 },
        { name: 'Sauce feuille', price: 22000 },
      ],
    },
    availability: { available: true },
    ...overrides,
  }
}
