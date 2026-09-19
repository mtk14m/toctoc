import type { PrismaClient } from '../generated/prisma/client.js'
import type { PaymentRecord, PaymentStore } from '../services/payment.js'

export class PrismaPaymentStore implements PaymentStore {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = await this.db.payment.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        status: true,
        orderItem: {
          select: {
            id: true,
            status: true,
            quantity: true,
            user: { select: { name: true } },
            menuItem: { select: { name: true } },
            groupOrder: { select: { id: true, status: true, orderCutoffTime: true } },
          },
        },
      },
    })
    if (!payment) return null

    const { user, menuItem, ...orderItem } = payment.orderItem
    return {
      ...payment,
      orderItem: { ...orderItem, participantName: user.name, menuItemName: menuItem.name },
    }
  }

  countActiveOrderItems(groupOrderId: string): Promise<number> {
    return this.db.orderItem.count({
      where: { groupOrderId, status: { not: 'CANCELLED' } },
    })
  }

  settle(
    paymentId: string,
    input: {
      providerTransactionId: string
      paidAt: Date
      orderItemStatus: 'CONFIRMED' | 'CANCELLED'
    },
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      // `status: 'PENDING'` dans le filtre : la base garantit qu'un seul des appels simultanés gagne.
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          providerTransactionId: input.providerTransactionId,
          paidAt: input.paidAt,
        },
      })
      if (count !== 1) return false

      const { orderItemId } = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderItemId: true },
      })
      // Une commande déjà annulée le reste : l'argent est encaissé, le remboursement est à part.
      await tx.orderItem.updateMany({
        where: { id: orderItemId, status: 'PENDING_PAYMENT' },
        data: { status: input.orderItemStatus },
      })
      return true
    })
  }

  fail(paymentId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'FAILED' },
      })
      if (count !== 1) return false

      const { orderItemId } = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderItemId: true },
      })
      await tx.orderItem.updateMany({
        where: { id: orderItemId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })
      return true
    })
  }
}
