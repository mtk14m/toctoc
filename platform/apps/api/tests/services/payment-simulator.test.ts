import { beforeEach, describe, expect, it } from 'vitest'
import { createPaymentService } from '../../src/services/payment.js'
import { createPaymentSimulator } from '../../src/services/payment-simulator.js'
import {
  InMemoryGroupOrderStore,
  InMemoryPaymentStore,
  InMemoryUserStore,
  RecordingPaymentGateway,
  RecordingPublisher,
  TEST_WEBHOOK_SECRET,
} from '../helpers/fakes.js'

describe('PaymentSimulator — payer sans opérateur, en développement', () => {
  let groups: InMemoryGroupOrderStore
  let store: InMemoryPaymentStore
  let simulator: ReturnType<typeof createPaymentSimulator>
  let itemId: string

  beforeEach(async () => {
    const users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    store = new InMemoryPaymentStore(groups)
    const payments = createPaymentService({
      store,
      gateway: new RecordingPaymentGateway(),
      realtime: new RecordingPublisher(),
      now: () => new Date('2026-09-21T10:05:00.000Z'),
    })
    simulator = createPaymentSimulator({
      store,
      payments,
      webhookSecret: TEST_WEBHOOK_SECRET,
    })

    const aicha = await users.create({ phone: '+224622000001', name: 'Aïcha' })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: aicha.id,
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: new Date('2026-09-21T11:05:00.000Z'),
      paymentMode: 'SPLIT',
      status: 'OPEN',
    })
    itemId = 'item_1'
    groups.orderItems.push({
      id: itemId,
      groupOrderId: 'group_1',
      userId: aicha.id,
      participantName: 'Aïcha',
      menuItemName: 'Riz gras',
      quantity: 1,
      status: 'PENDING_PAYMENT',
    })
    store.createPending(itemId, 31000)
  })

  it('confirme le paiement comme le ferait l’opérateur : la part est payée', async () => {
    const outcome = await simulator.simulate(itemId, 'CONFIRMED')

    expect(outcome).toBe('confirmed')
    expect(groups.orderItems[0]!.status).toBe('CONFIRMED')
    expect(store.payments[0]).toMatchObject({ status: 'CONFIRMED', paidAt: expect.any(Date) })
  })

  it('simule un échec : la part est annulée', async () => {
    const outcome = await simulator.simulate(itemId, 'FAILED')

    expect(outcome).toBe('failed')
    expect(groups.orderItems[0]!.status).toBe('CANCELLED')
  })

  it('rejoue sans risque : un paiement déjà traité l’est une seule fois', async () => {
    await simulator.simulate(itemId, 'CONFIRMED')

    expect(await simulator.simulate(itemId, 'CONFIRMED')).toBe('already_processed')
  })

  it('répond 404 pour une part qui n’a pas de paiement', async () => {
    await expect(simulator.simulate('inconnue', 'CONFIRMED')).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    })
  })

  it('passe par la vraie vérification de signature : un mauvais secret est refusé', async () => {
    const wrong = createPaymentSimulator({
      store,
      payments: createPaymentService({
        store,
        gateway: new RecordingPaymentGateway(),
        realtime: new RecordingPublisher(),
      }),
      webhookSecret: 'un-autre-secret-de-32-caracteres-ok',
    })

    await expect(wrong.simulate(itemId, 'CONFIRMED')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_SIGNATURE',
    })
  })
})
