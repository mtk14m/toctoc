export interface DishLine {
  dish: string
  quantity: number
}

/**
 * Regroupe les plats identiques et les classe du plus commandé au moins commandé, puis par ordre
 * alphabétique : le récap du restaurant, le manifeste du livreur et la vue de l'équipe disent la
 * même chose de la même façon.
 */
export function summarizeDishes(items: readonly DishLine[]): { dishes: DishLine[]; total: number } {
  const byDish = new Map<string, number>()
  for (const { dish, quantity } of items) {
    byDish.set(dish, (byDish.get(dish) ?? 0) + quantity)
  }

  const dishes = [...byDish]
    .map(([dish, quantity]) => ({ dish, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.dish.localeCompare(b.dish, 'fr'))
  return { dishes, total: dishes.reduce((sum, line) => sum + line.quantity, 0) }
}
