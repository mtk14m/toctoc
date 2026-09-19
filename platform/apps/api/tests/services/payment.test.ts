import { beforeEach, describe, expect, it } from 'vitest'
import { PAYMENT_GRACE_MS, createPaymentService } from '../../src/services/payment.js'
import { createOrderItemService } from '../../src/services/order-item.js'
import {
  InMemoryGroupOrderStore,
  InMemoryOrderItemStore,
  InMemoryPaymentStore,
  InMemoryRateLimiter,
  InMemoryUserStore,
  RecordingPaymentGateway,
} from '../helpers/fakes.js'

const NOW = new Date('2026-09-21T08:00:00.000Z')
const CUTOFF = new Date('2026-09-21T10:30:00.000Z')
const DELIVERY = new Date('2026-09-21T12:00:00.000Z')

describe('PaymentService', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let paymentStore: InMemoryPaymentStore
  let gateway: RecordingPaymentGateway
  let payments: ReturnType<typeof createPaymentService>
  let orderItems: ReturnType<typeof createOrderItemService>
  let current: Date

  const join = (phone = '622000001', name = 'Aïcha') =>
    orderItems.join('lien', { menuItemId: 'menu_riz', quantity: 1, phone, name }, '203.0.113.7')

  const event = (overrides: Record<string, unknown> = {}) => ({
    reference: paymentStore.payments[0]!.id,
    providerTransactionId: 'tx_operateur_1',
    amount: 31000,
    status: 'CONFIRMED' as const,
    ...overrides,
  })

  beforeEach(() => {
    current = NOW
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    paymentStore = new InMemoryPaymentStore(groups)
    gateway = new RecordingPaymentGateway()
    payments = createPaymentService({ store: paymentStore, gateway, now: () => current })
    orderItems = createOrderItemService({
      store: new InMemoryOrderItemStore(groups, users, paymentStore),
      users,
      payments,
      rateLimiter: new InMemoryRateLimiter(),
      defaultCountryCode: '224',
      now: () => current,
    })

    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: 'user_relais',
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: CUTOFF,
      deliveryTime: DELIVERY,
      paymentMode: 'SPLIT',
      status: 'OPEN',
    })
    groups.menuItems.push({
      id: 'menu_riz',
      partnerId: 'partner_1',
      name: 'Riz gras',
      description: null,
      price: 25000,
      photoUrl: null,
      availableDate: new Date('2026-09-21'),
      active: true,
    })
  })

  describe('au moment de rejoindre (mode SPLIT)', () => {
    it('crée un paiement en attente du montant exact et le lance chez l’opérateur', async () => {
      const result = await join('622 00 00 01')

      expect(result.payment).toEqual({ status: 'PENDING' })
      expect(paymentStore.payments).toHaveLength(1)
      expect(paymentStore.payments[0]).toMatchObject({
        amount: 31000, // 25 000 + 6 000 de livraison, une seule transaction (docs/08)
        status: 'PENDING',
        providerTransactionId: null,
      })
      expect(gateway.initiated).toEqual([
        {
          reference: paymentStore.payments[0]!.id,
          amount: 31000,
          currency: 'GNF',
          phone: '+224622000001',
        },
      ])
    })

    it('n’initie aucun paiement en HOST_PAYS : le créateur règle tout à l’heure limite', async () => {
      groups.groupOrders[0]!.paymentMode = 'HOST_PAYS'

      const result = await join()

      expect(result.payment).toBeNull()
      expect(paymentStore.payments).toHaveLength(0)
      expect(gateway.initiated).toHaveLength(0)
    })

    it('annule la commande si l’opérateur est injoignable (502), le participant peut réessayer', async () => {
      gateway.failWith = new Error('opérateur en panne')

      await expect(join()).rejects.toMatchObject({ statusCode: 502, code: 'PAYMENT_UNAVAILABLE' })
      expect(groups.orderItems[0]!.status).toBe('CANCELLED')
      expect(paymentStore.payments[0]!.status).toBe('FAILED')

      gateway.failWith = null
      await expect(join()).resolves.toMatchObject({ status: 'PENDING_PAYMENT' })
    })

    it('garde l’erreur de l’opérateur en cause, pour les logs (jamais renvoyée au client)', async () => {
      const boom = new Error('opérateur en panne')
      gateway.failWith = boom

      await expect(join()).rejects.toMatchObject({ cause: boom })
    })
  })

  describe('handleEvent — paiement confirmé', () => {
    beforeEach(async () => {
      await join()
    })

    it('confirme le paiement puis la commande (« argent encaissé », docs/08)', async () => {
      current = new Date('2026-09-21T09:00:00.000Z')

      const outcome = await payments.handleEvent(event())

      expect(outcome).toBe('confirmed')
      expect(paymentStore.payments[0]).toMatchObject({
        status: 'CONFIRMED',
        providerTransactionId: 'tx_operateur_1',
        paidAt: current,
      })
      expect(groups.orderItems[0]!.status).toBe('CONFIRMED')
    })

    it('est idempotent : un évènement rejoué (l’opérateur réessaie) ne change rien', async () => {
      current = new Date('2026-09-21T09:00:00.000Z')
      await payments.handleEvent(event())
      current = new Date('2026-09-21T09:05:00.000Z')

      const outcome = await payments.handleEvent(event())

      expect(outcome).toBe('already_processed')
      expect(paymentStore.payments[0]!.paidAt).toEqual(new Date('2026-09-21T09:00:00.000Z'))
    })

    it('accepte encore un paiement dans la fenêtre de grâce après l’heure limite', async () => {
      current = new Date(CUTOFF.getTime() + PAYMENT_GRACE_MS - 1000)

      expect(await payments.handleEvent(event())).toBe('confirmed')
      expect(groups.orderItems[0]!.status).toBe('CONFIRMED')
    })

    it('refuse un montant différent de celui attendu (422 AMOUNT_MISMATCH), sans rien changer', async () => {
      await expect(payments.handleEvent(event({ amount: 1000 }))).rejects.toMatchObject({
        statusCode: 422,
        code: 'AMOUNT_MISMATCH',
      })
      expect(paymentStore.payments[0]!.status).toBe('PENDING')
      expect(groups.orderItems[0]!.status).toBe('PENDING_PAYMENT')
    })

    it('répond 404 PAYMENT_NOT_FOUND pour une référence inconnue', async () => {
      await expect(payments.handleEvent(event({ reference: 'inconnue' }))).rejects.toMatchObject({
        statusCode: 404,
        code: 'PAYMENT_NOT_FOUND',
      })
    })
  })

  describe('handleEvent — paiement arrivé trop tard (docs/09 : fenêtre de grâce de 2 minutes)', () => {
    beforeEach(async () => {
      await join()
    })

    it('encaisse mais n’ajoute pas la commande au récap : elle est annulée, à rembourser', async () => {
      current = new Date(CUTOFF.getTime() + PAYMENT_GRACE_MS)

      const outcome = await payments.handleEvent(event())

      expect(outcome).toBe('late')
      expect(paymentStore.payments[0]!.status).toBe('CONFIRMED') // l'argent est bien parti
      expect(groups.orderItems[0]!.status).toBe('CANCELLED') // mais pas de repas
    })

    it('traite de la même façon un paiement dont la commande a déjà été annulée', async () => {
      groups.orderItems[0]!.status = 'CANCELLED'

      expect(await payments.handleEvent(event())).toBe('late')
      expect(paymentStore.payments[0]!.status).toBe('CONFIRMED')
      expect(groups.orderItems[0]!.status).toBe('CANCELLED')
    })

    it('traite de la même façon un paiement sur un lien déjà clôturé', async () => {
      groups.groupOrders[0]!.status = 'CLOSED'

      expect(await payments.handleEvent(event())).toBe('late')
      expect(groups.orderItems[0]!.status).toBe('CANCELLED')
    })
  })

  describe('handleEvent — paiement échoué', () => {
    beforeEach(async () => {
      await join()
    })

    it('annule la commande de cette personne seulement, et libère son numéro', async () => {
      await join('622000002', 'Mamadou')
      const failedReference = paymentStore.payments[0]!.id

      const outcome = await payments.handleEvent(
        event({ reference: failedReference, status: 'FAILED' }),
      )

      expect(outcome).toBe('failed')
      expect(paymentStore.payments[0]!.status).toBe('FAILED')
      expect(groups.orderItems.map((i) => i.status)).toEqual(['CANCELLED', 'PENDING_PAYMENT'])
      // elle peut réessayer, et son rang n'est pas perdu : la commande annulée ne compte plus
      await expect(join()).resolves.toMatchObject({ status: 'PENDING_PAYMENT', deliveryFee: 6000 })
    })

    it('ignore un échec tardif pour un paiement déjà confirmé (l’argent est là)', async () => {
      await payments.handleEvent(event())

      const outcome = await payments.handleEvent(event({ status: 'FAILED' }))

      expect(outcome).toBe('already_processed')
      expect(paymentStore.payments[0]!.status).toBe('CONFIRMED')
      expect(groups.orderItems[0]!.status).toBe('CONFIRMED')
    })

    it('est idempotent : un échec rejoué ne change rien', async () => {
      await payments.handleEvent(event({ status: 'FAILED' }))

      expect(await payments.handleEvent(event({ status: 'FAILED' }))).toBe('already_processed')
    })
  })
})
