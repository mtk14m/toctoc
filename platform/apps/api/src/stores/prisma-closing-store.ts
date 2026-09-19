import type { GroupOrderStatus } from '../generated/prisma/enums.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { CloseResult, ClosingStore, RecapCandidate } from '../services/closing.js'

export class PrismaClosingStore implements ClosingStore {
  constructor(private readonly db: PrismaClient) {}

  async findDueGroupOrderIds(cutoffBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.db.groupOrder.findMany({
      // HOST_PAYS est exclu : ses commandes sont « en attente » par conception (charge du créateur).
      where: { status: 'OPEN', paymentMode: 'SPLIT', orderCutoffTime: { lte: cutoffBefore } },
      orderBy: { orderCutoffTime: 'asc' },
      take: limit,
      select: { id: true },
    })
    return rows.map((row) => row.id)
  }

  close(groupOrderId: string): Promise<CloseResult> {
    return this.db.$transaction(async (tx) => {
      // Le même verrou que `join` et `settle` : plus personne ne peut ajouter ni confirmer une
      // commande sur ce lien pendant qu'on le ferme.
      const [order] = await tx.$queryRaw<Array<{ status: GroupOrderStatus }>>`
        SELECT "status" FROM "GroupOrder" WHERE "id" = ${groupOrderId} FOR UPDATE`
      if (order?.status !== 'OPEN') return { status: 'skipped' as const }

      const unpaid = await tx.orderItem.findMany({
        where: { groupOrderId, status: 'PENDING_PAYMENT' },
        select: { id: true },
      })
      // Les Payment en attente restent PENDING : un débit confirmé après coup doit rester reconnu.
      await tx.orderItem.updateMany({
        where: { groupOrderId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })

      const paid = await tx.orderItem.count({ where: { groupOrderId, status: 'CONFIRMED' } })
      const status = paid > 0 ? ('CLOSED' as const) : ('CANCELLED' as const)
      await tx.groupOrder.update({ where: { id: groupOrderId }, data: { status } })

      return {
        status: paid > 0 ? ('closed' as const) : ('cancelled' as const),
        cancelledOrderItemIds: unpaid.map((item) => item.id),
      }
    })
  }

  async findPendingRecaps(limit: number): Promise<RecapCandidate[]> {
    const orders = await this.db.groupOrder.findMany({
      where: { status: 'CLOSED', partnerNotifiedAt: null },
      orderBy: { deliveryTime: 'asc' },
      take: limit,
      select: {
        id: true,
        deliveryAddress: true,
        deliveryTime: true,
        partner: { select: { name: true, phone: true } },
        orderItems: {
          where: { status: 'CONFIRMED' },
          select: { quantity: true, menuItem: { select: { name: true } } },
        },
      },
    })

    return orders.map((order) => ({
      groupOrderId: order.id,
      partner: order.partner,
      deliveryAddress: order.deliveryAddress,
      deliveryTime: order.deliveryTime,
      items: order.orderItems.map((item) => ({
        dish: item.menuItem.name,
        quantity: item.quantity,
      })),
    }))
  }

  async markPartnerNotified(groupOrderId: string, at: Date): Promise<void> {
    // `partnerNotifiedAt: null` dans le filtre : la première date posée reste, jamais écrasée.
    await this.db.groupOrder.updateMany({
      where: { id: groupOrderId, partnerNotifiedAt: null },
      data: { partnerNotifiedAt: at },
    })
  }
}
