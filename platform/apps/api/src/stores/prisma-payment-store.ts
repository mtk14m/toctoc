import type { PrismaClient } from '../generated/prisma/client.js'
import type { PaymentRecord, PaymentStore } from '../services/payment.js'

export class PrismaPaymentStore implements PaymentStore {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<PaymentRecord | null> {
    return this.db.payment.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        status: true,
        orderItem: {
          select: {
            id: true,
            status: true,
            groupOrder: { select: { status: true, orderCutoffTime: true } },
          },
        },
      },
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
