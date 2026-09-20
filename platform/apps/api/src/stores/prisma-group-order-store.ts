import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  GroupOrderRecord,
  GroupOrderStore,
  MenuEntry,
  NewGroupOrder,
  OrderItemEntry,
  PartnerSummary,
} from '../services/group-order.js'

export class PrismaGroupOrderStore implements GroupOrderStore {
  constructor(private readonly db: PrismaClient) {}

  findPartner(id: string): Promise<PartnerSummary | null> {
    return this.db.partner.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        active: true,
        serviceStartMinute: true,
        serviceEndMinute: true,
      },
    })
  }

  create({ deliveryLat, deliveryLng, ...input }: NewGroupOrder) {
    return this.db.groupOrder.create({
      // Prisma (exactOptionalPropertyTypes) refuse un `undefined` explicite : on n'envoie que ce qui existe.
      data: {
        ...input,
        ...(deliveryLat !== undefined && { deliveryLat }),
        ...(deliveryLng !== undefined && { deliveryLng }),
      },
      select: { id: true, status: true },
    })
  }

  async findByShareToken(shareToken: string): Promise<GroupOrderRecord | null> {
    const order = await this.db.groupOrder.findUnique({
      where: { shareToken },
      select: {
        id: true,
        status: true,
        deliveryAddress: true,
        orderCutoffTime: true,
        deliveryTime: true,
        paymentMode: true,
        creator: { select: { name: true } },
        partner: { select: { id: true, name: true, type: true } },
        delivery: { select: { status: true, confirmationCode: true } },
      },
    })
    if (!order) return null

    const { creator, ...rest } = order
    return { ...rest, creatorName: creator.name }
  }

  listMenu(partnerId: string, date: Date): Promise<MenuEntry[]> {
    return this.db.menuItem.findMany({
      where: { partnerId, availableDate: date, active: true },
      select: { id: true, name: true, description: true, price: true, photoUrl: true },
      orderBy: { name: 'asc' },
    })
  }

  async listOrderItems(groupOrderId: string): Promise<OrderItemEntry[]> {
    // Dans l'ordre d'arrivée : c'est l'ordre dans lequel la liste « se remplit » à l'écran.
    const items = await this.db.orderItem.findMany({
      where: { groupOrderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        quantity: true,
        status: true,
        user: { select: { name: true } },
        menuItem: { select: { name: true } },
      },
    })

    return items.map(({ user, menuItem, ...item }) => ({
      ...item,
      participantName: user.name,
      menuItemName: menuItem.name,
    }))
  }
}
