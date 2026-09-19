import type { createTestDeps } from './fakes.js'

const HOUR = 60 * 60 * 1000

/**
 * Un lien ouvert (heure limite dans 2 h, livraison dans 4 h) avec un plat au menu du jour, pour
 * les tests qui passent par l'horloge réelle (routes, sockets). Renvoie ce qu'il faut pour y
 * rejoindre : le jeton du lien et l'id du plat.
 */
export async function seedOpenGroupOrder(
  deps: ReturnType<typeof createTestDeps>,
  options: { shareToken: string; paymentMode?: 'SPLIT' | 'HOST_PAYS' },
) {
  const { shareToken, paymentMode = 'SPLIT' } = options
  const n = deps.groupOrderStore.groupOrders.length + 1
  const partnerId = `partner_${n}`
  const menuItemId = `menu_${n}`

  const relais =
    (await deps.userStore.findByPhone('+224621000000')) ??
    (await deps.userStore.create({ phone: '+224621000000', name: 'Mamadou' }))

  const deliveryTime = new Date(Date.now() + 4 * HOUR)
  deps.groupOrderStore.partners.push({
    id: partnerId,
    name: 'Chez Aïssatou',
    type: 'CUISINE_MAISON',
    active: true,
  })
  deps.groupOrderStore.groupOrders.push({
    id: `group_${n}`,
    creatorId: relais.id,
    partnerId,
    shareToken,
    deliveryAddress: 'Kaloum Center',
    orderCutoffTime: new Date(Date.now() + 2 * HOUR),
    deliveryTime,
    paymentMode,
    status: 'OPEN',
  })
  deps.groupOrderStore.menuItems.push({
    id: menuItemId,
    partnerId,
    name: 'Riz gras',
    description: null,
    price: 25000,
    photoUrl: null,
    availableDate: new Date(
      Date.UTC(
        deliveryTime.getUTCFullYear(),
        deliveryTime.getUTCMonth(),
        deliveryTime.getUTCDate(),
      ),
    ),
    active: true,
  })

  return { groupOrderId: `group_${n}`, shareToken, menuItemId }
}
