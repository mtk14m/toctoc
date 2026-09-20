import type { PrismaClient } from '../generated/prisma/client.js'
import type { RefundMarkResult, RefundRecord, RefundStore } from '../services/refund.js'

const REFUNDED_ACTION = 'order_item.refunded'

export class PrismaRefundStore implements RefundStore {
  constructor(private readonly db: PrismaClient) {}

  async listPending(): Promise<RefundRecord[]> {
    const payments = await this.db.payment.findMany({
      where: { status: 'CONFIRMED', orderItem: { status: 'CANCELLED' } },
      select: {
        id: true,
        orderItemId: true,
        amount: true,
        currency: true,
        paidAt: true,
        providerTransactionId: true,
        orderItem: {
          select: {
            groupOrder: { select: { id: true, partner: { select: { name: true } } } },
            user: { select: { name: true, phone: true } },
          },
        },
      },
    })

    // Le journal d'audit n'a pas de relation vers les parts : on retire celles déjà remboursées.
    const refunded = await this.db.auditLog.findMany({
      where: {
        action: REFUNDED_ACTION,
        targetType: 'OrderItem',
        targetId: { in: payments.map((payment) => payment.orderItemId) },
      },
      select: { targetId: true },
    })
    const alreadyRefunded = new Set(refunded.map((log) => log.targetId))

    return payments
      .filter((payment) => !alreadyRefunded.has(payment.orderItemId))
      .map(({ orderItem, ...payment }) => ({
        orderItemId: payment.orderItemId,
        paymentId: payment.id,
        groupOrderId: orderItem.groupOrder.id,
        restaurantName: orderItem.groupOrder.partner.name,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
        providerTransactionId: payment.providerTransactionId,
        participant: orderItem.user,
      }))
  }

  markRefunded(input: {
    orderItemId: string
    actorId: string
    reference: string
  }): Promise<RefundMarkResult> {
    return this.db.$transaction(async (tx) => {
      // Le verrou sur la part sérialise deux clics simultanés : le second voit le journal du premier.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OrderItem" WHERE "id" = ${input.orderItemId} FOR UPDATE`
      if (locked.length === 0) return { status: 'not_found' as const }

      const alreadyRefunded = await tx.auditLog.findFirst({
        where: { action: REFUNDED_ACTION, targetType: 'OrderItem', targetId: input.orderItemId },
        select: { id: true },
      })
      if (alreadyRefunded) return { status: 'already_refunded' as const }

      const payment = await tx.payment.findFirst({
        where: {
          orderItemId: input.orderItemId,
          status: 'CONFIRMED',
          orderItem: { status: 'CANCELLED' },
        },
        select: { id: true, amount: true },
      })
      if (!payment) return { status: 'not_refundable' as const }

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: REFUNDED_ACTION,
          targetType: 'OrderItem',
          targetId: input.orderItemId,
          metadata: { paymentId: payment.id, amount: payment.amount, reference: input.reference },
        },
      })
      return { status: 'recorded' as const }
    })
  }
}
