import type { GroupOrderStatus } from '../generated/prisma/enums.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  AddOrderItemResult,
  JoinableGroupOrder,
  JoinableMenuItem,
  NewOrderItem,
  OrderItemStore,
} from '../services/order-item.js'
import type { OrderItemPrice } from '../services/pricing.js'

export class PrismaOrderItemStore implements OrderItemStore {
  constructor(private readonly db: PrismaClient) {}

  async findGroupOrderForJoin(shareToken: string): Promise<JoinableGroupOrder | null> {
    return this.db.groupOrder.findUnique({
      where: { shareToken },
      select: {
        id: true,
        status: true,
        orderCutoffTime: true,
        deliveryTime: true,
        partner: { select: { id: true, commissionRate: true } },
      },
    })
  }

  findMenuItem(id: string): Promise<JoinableMenuItem | null> {
    return this.db.menuItem.findUnique({
      where: { id },
      select: {
        id: true,
        partnerId: true,
        name: true,
        price: true,
        active: true,
        availableDate: true,
      },
    })
  }

  addOrderItem(
    input: NewOrderItem,
    pricer: (existingActiveOrderItems: number) => OrderItemPrice,
  ): Promise<AddOrderItemResult> {
    return this.db.$transaction(async (tx) => {
      // Verrou de ligne sur le lien : les commandes simultanées y font la queue, et chacune lit un
      // compte à jour (READ COMMITTED : la lecture suivante voit ce que la précédente a validé).
      const [order] = await tx.$queryRaw<Array<{ status: GroupOrderStatus }>>`
        SELECT "status" FROM "GroupOrder" WHERE "id" = ${input.groupOrderId} FOR UPDATE`
      if (order?.status !== 'OPEN') return { status: 'closed' as const }

      const active = await tx.orderItem.findMany({
        where: { groupOrderId: input.groupOrderId, status: { not: 'CANCELLED' } },
        select: { userId: true },
      })
      if (active.some((item) => item.userId === input.userId)) {
        return { status: 'already_joined' as const }
      }

      const price = pricer(active.length)
      const item = await tx.orderItem.create({
        data: {
          groupOrderId: input.groupOrderId,
          userId: input.userId,
          menuItemId: input.menuItemId,
          quantity: input.quantity,
          unitPrice: price.unitPrice,
          deliveryFee: price.deliveryFee,
          commissionAmount: price.commissionAmount,
        },
        select: { id: true, status: true },
      })

      return { status: 'created' as const, item, price }
    })
  }
}
