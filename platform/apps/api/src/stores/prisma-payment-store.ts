import type { PrismaClient } from '../generated/prisma/client.js'
import type { PaymentRecord, PaymentStore, SettleResult } from '../services/payment.js'

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
  ): Promise<SettleResult> {
    return this.db.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { orderItem: { select: { id: true, groupOrderId: true } } },
      })
      if (!payment) return { applied: false as const }
      const { id: orderItemId, groupOrderId } = payment.orderItem

      // Le même verrou que `join` et la clôture : on écrit soit avant la fermeture du lien, soit
      // après l'avoir vue, jamais au milieu.
      await tx.$queryRaw`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId} FOR UPDATE`

      // `status: 'PENDING'` dans le filtre : la base garantit qu'un seul des appels simultanés gagne.
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          providerTransactionId: input.providerTransactionId,
          paidAt: input.paidAt,
        },
      })
      if (count !== 1) return { applied: false as const }

      // Un lien qui n'est plus ouvert ne confirme plus rien, même si on nous le demandait.
      const group = await tx.groupOrder.findUniqueOrThrow({
        where: { id: groupOrderId },
        select: { status: true },
      })
      const target =
        input.orderItemStatus === 'CONFIRMED' && group.status !== 'OPEN'
          ? 'CANCELLED'
          : input.orderItemStatus
      // Une commande déjà annulée (par la clôture) le reste : l'argent est encaissé, le
      // remboursement est à part.
      await tx.orderItem.updateMany({
        where: { id: orderItemId, status: 'PENDING_PAYMENT' },
        data: { status: target },
      })

      const item = await tx.orderItem.findUniqueOrThrow({
        where: { id: orderItemId },
        select: { status: true },
      })
      return {
        applied: true as const,
        orderItemStatus:
          item.status === 'CONFIRMED' ? ('CONFIRMED' as const) : ('CANCELLED' as const),
      }
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
