import { beforeEach, describe, expect, it } from 'vitest'
import { createRefundService } from '../../src/services/refund.js'
import {
  InMemoryGroupOrderStore,
  InMemoryPaymentStore,
  InMemoryRefundStore,
  InMemoryUserStore,
} from '../helpers/fakes.js'

const OPS = 'admin_1'

describe('RefundService — les paiements encaissés sans repas, à rembourser à la main', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let payments: InMemoryPaymentStore
  let store: InMemoryRefundStore
  let service: ReturnType<typeof createRefundService>
  let aicha: string
  let mamadou: string

  /** Une part et son paiement, dans l'état voulu. */
  const seed = (
    userId: string,
    name: string,
    itemStatus: 'CONFIRMED' | 'CANCELLED' | 'PENDING_PAYMENT',
    paymentStatus: 'CONFIRMED' | 'FAILED' | 'PENDING',
    paidAt: Date | null = new Date('2026-09-21T10:25:00.000Z'),
  ) => {
    const itemId = `item_${groups.orderItems.length + 1}`
    groups.orderItems.push({
      id: itemId,
      groupOrderId: 'group_1',
      userId,
      participantName: name,
      menuItemName: 'Riz gras',
      quantity: 1,
      status: itemStatus,
    })
    const payment = payments.createPending(itemId, 31000)
    payment.status = paymentStatus
    payment.providerTransactionId = paymentStatus === 'CONFIRMED' ? `tx_${itemId}` : null
    payment.paidAt = paymentStatus === 'CONFIRMED' ? paidAt : null
    return { itemId, paymentId: payment.id }
  }

  beforeEach(async () => {
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    payments = new InMemoryPaymentStore(groups)
    store = new InMemoryRefundStore(groups, users, payments)
    service = createRefundService({ store })

    aicha = (await users.create({ phone: '+224622000001', name: 'Aïcha' })).id
    mamadou = (await users.create({ phone: '+224622000002', name: 'Mamadou' })).id
    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: aicha,
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: new Date('2026-09-21T11:05:00.000Z'),
      paymentMode: 'SPLIT',
      status: 'CLOSED',
    })
  })

  describe('listPending', () => {
    it('liste les paiements encaissés dont la part est annulée, avec de quoi rembourser', async () => {
      const late = seed(aicha, 'Aïcha', 'CANCELLED', 'CONFIRMED')

      const refunds = await service.listPending()

      expect(refunds).toEqual([
        {
          orderItemId: late.itemId,
          paymentId: late.paymentId,
          groupOrderId: 'group_1',
          restaurantName: 'Chez Aïssatou',
          amount: 31000,
          currency: 'GNF',
          paidAt: new Date('2026-09-21T10:25:00.000Z'),
          providerTransactionId: `tx_${late.itemId}`,
          participant: { name: 'Aïcha', phone: '+224622000001' },
        },
      ])
    })

    it('ne liste que ce qui est vraiment à rembourser', async () => {
      seed(aicha, 'Aïcha', 'CONFIRMED', 'CONFIRMED') // payé et livré : rien à rembourser
      seed(aicha, 'Aïcha', 'CANCELLED', 'FAILED') // le débit n'a pas eu lieu
      seed(mamadou, 'Mamadou', 'CANCELLED', 'PENDING') // pas (encore) débité
      const late = seed(mamadou, 'Mamadou', 'CANCELLED', 'CONFIRMED')

      const refunds = await service.listPending()

      expect(refunds.map((r) => r.orderItemId)).toEqual([late.itemId])
    })

    it('les plus anciens d’abord : ce sont ceux qui attendent depuis le plus longtemps', async () => {
      const recent = seed(
        aicha,
        'Aïcha',
        'CANCELLED',
        'CONFIRMED',
        new Date('2026-09-21T11:00:00.000Z'),
      )
      const oldest = seed(
        mamadou,
        'Mamadou',
        'CANCELLED',
        'CONFIRMED',
        new Date('2026-09-21T10:21:00.000Z'),
      )

      const refunds = await service.listPending()

      expect(refunds.map((r) => r.orderItemId)).toEqual([oldest.itemId, recent.itemId])
    })

    it('ne liste plus un paiement une fois son remboursement enregistré', async () => {
      const late = seed(aicha, 'Aïcha', 'CANCELLED', 'CONFIRMED')
      await service.markRefunded(OPS, late.itemId, 'OM-2026-0921-77')

      expect(await service.listPending()).toEqual([])
    })
  })

  describe('markRefunded', () => {
    it('enregistre le remboursement avec sa référence, et trace qui l’a fait', async () => {
      const late = seed(aicha, 'Aïcha', 'CANCELLED', 'CONFIRMED')

      const result = await service.markRefunded(OPS, late.itemId, 'OM-2026-0921-77')

      expect(result).toEqual({ orderItemId: late.itemId, refunded: true })
      expect(store.auditLogs).toEqual([
        {
          actorId: OPS,
          action: 'order_item.refunded',
          targetType: 'OrderItem',
          targetId: late.itemId,
          metadata: { paymentId: late.paymentId, amount: 31000, reference: 'OM-2026-0921-77' },
        },
      ])
    })

    it('ne rembourse pas deux fois (409 ALREADY_REFUNDED), même avec une autre référence', async () => {
      const late = seed(aicha, 'Aïcha', 'CANCELLED', 'CONFIRMED')
      await service.markRefunded(OPS, late.itemId, 'OM-1')

      await expect(service.markRefunded(OPS, late.itemId, 'OM-2')).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALREADY_REFUNDED',
      })
      expect(store.auditLogs).toHaveLength(1)
    })

    it.each([
      ['une part livrée', 'CONFIRMED', 'CONFIRMED'],
      ['un paiement échoué', 'CANCELLED', 'FAILED'],
      ['un paiement pas encore débité', 'CANCELLED', 'PENDING'],
    ] as const)('refuse de rembourser %s (409 NOT_REFUNDABLE)', async (_label, item, payment) => {
      const seeded = seed(aicha, 'Aïcha', item, payment)

      await expect(service.markRefunded(OPS, seeded.itemId, 'OM-1')).rejects.toMatchObject({
        statusCode: 409,
        code: 'NOT_REFUNDABLE',
      })
      expect(store.auditLogs).toEqual([])
    })

    it('répond 404 pour une part inconnue', async () => {
      await expect(service.markRefunded(OPS, 'inconnue', 'OM-1')).rejects.toMatchObject({
        statusCode: 404,
        code: 'ORDER_ITEM_NOT_FOUND',
      })
    })
  })
})
