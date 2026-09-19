import { beforeEach, describe, expect, it } from 'vitest'
import { createClosingService, formatRecap } from '../../src/services/closing.js'
import { PAYMENT_GRACE_MS } from '../../src/services/payment.js'
import {
  InMemoryClosingStore,
  InMemoryGroupOrderStore,
  InMemoryPaymentStore,
  InMemoryUserStore,
  RecordingPartnerNotifier,
  RecordingPublisher,
} from '../helpers/fakes.js'

const CUTOFF = new Date('2026-09-21T10:30:00.000Z')
const DELIVERY = new Date('2026-09-21T12:00:00.000Z')
const GRACE_OVER = new Date(CUTOFF.getTime() + PAYMENT_GRACE_MS)

describe('formatRecap', () => {
  const recap = {
    groupOrderId: 'group_1',
    partner: { name: 'Chez Aïssatou', phone: '+224622000000' },
    deliveryAddress: 'Kaloum Center, 3e étage',
    deliveryTime: DELIVERY,
    items: [
      { dish: 'Attiéké poisson', quantity: 1 },
      { dish: 'Riz gras', quantity: 2 },
      { dish: 'Riz gras', quantity: 1 },
    ],
  }

  it('regroupe les commandes par plat, du plus commandé au moins commandé', () => {
    expect(formatRecap(recap)).toBe(
      [
        'Bonjour Chez Aïssatou, voici la commande TocToc à préparer :',
        '3× Riz gras',
        '1× Attiéké poisson',
        'Total : 4 plats',
        'Livraison le 21/09 à 12h00 — Kaloum Center, 3e étage',
      ].join('\n'),
    )
  })

  it('accorde « plat » au singulier pour une seule commande', () => {
    const message = formatRecap({ ...recap, items: [{ dish: 'Riz gras', quantity: 1 }] })

    expect(message).toContain('Total : 1 plat\n')
  })

  it('classe par ordre alphabétique quand les quantités sont égales', () => {
    const message = formatRecap({
      ...recap,
      items: [
        { dish: 'Riz gras', quantity: 2 },
        { dish: 'Attiéké poisson', quantity: 2 },
      ],
    })

    expect(message.indexOf('Attiéké poisson')).toBeLessThan(message.indexOf('Riz gras'))
  })

  it('écrit l’heure sur deux chiffres, en UTC (la Guinée n’a pas d’heure d’été)', () => {
    const message = formatRecap({ ...recap, deliveryTime: new Date('2026-09-25T13:05:00.000Z') })

    expect(message).toContain('Livraison le 25/09 à 13h05')
  })
})

describe('ClosingService', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let paymentStore: InMemoryPaymentStore
  let store: InMemoryClosingStore
  let notifier: RecordingPartnerNotifier
  let publisher: RecordingPublisher
  let errors: unknown[]
  let closing: ReturnType<typeof createClosingService>
  let current: Date

  const addGroupOrder = (id: string, overrides: Record<string, unknown> = {}) => {
    groups.groupOrders.push({
      id,
      creatorId: 'user_relais',
      partnerId: 'partner_1',
      shareToken: `lien-${id}`,
      deliveryAddress: 'Kaloum Center, 3e étage',
      orderCutoffTime: CUTOFF,
      deliveryTime: DELIVERY,
      paymentMode: 'SPLIT',
      status: 'OPEN',
      ...overrides,
    })
  }

  const addItem = (
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED',
    dish = 'Riz gras',
    groupOrderId = 'group_1',
  ) => {
    const id = `item_${groups.orderItems.length + 1}`
    groups.orderItems.push({
      id,
      groupOrderId,
      participantName: `Participant ${id}`,
      menuItemName: dish,
      quantity: 1,
      status,
    })
    return id
  }

  beforeEach(() => {
    current = GRACE_OVER
    errors = []
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    paymentStore = new InMemoryPaymentStore(groups)
    store = new InMemoryClosingStore(groups)
    notifier = new RecordingPartnerNotifier()
    publisher = new RecordingPublisher()
    closing = createClosingService({
      store,
      notifier,
      realtime: publisher,
      onError: (error) => errors.push(error),
      now: () => current,
    })
    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    addGroupOrder('group_1')
  })

  describe('closeDue', () => {
    it('ne touche pas un lien tant que la fenêtre de grâce de 2 minutes n’est pas écoulée', async () => {
      addItem('PENDING_PAYMENT')
      current = new Date(GRACE_OVER.getTime() - 1)

      const result = await closing.closeDue()

      expect(result).toEqual({ closed: 0, cancelled: 0 })
      expect(groups.groupOrders[0]!.status).toBe('OPEN')
      expect(groups.orderItems[0]!.status).toBe('PENDING_PAYMENT')
    })

    it('ferme le lien dès que la fenêtre de grâce est écoulée', async () => {
      addItem('CONFIRMED')

      const result = await closing.closeDue()

      expect(result).toEqual({ closed: 1, cancelled: 0 })
      expect(groups.groupOrders[0]!.status).toBe('CLOSED')
    })

    it('annule les commandes encore en attente de paiement et garde celles qui sont payées', async () => {
      addItem('CONFIRMED')
      addItem('PENDING_PAYMENT')
      addItem('CANCELLED')

      await closing.closeDue()

      expect(groups.orderItems.map((i) => i.status)).toEqual([
        'CONFIRMED',
        'CANCELLED',
        'CANCELLED',
      ])
    })

    it('laisse les paiements en attente tels quels : un débit tardif doit pouvoir être reconnu et remboursé', async () => {
      addItem('CONFIRMED')
      const pendingItem = addItem('PENDING_PAYMENT')
      paymentStore.createPending(pendingItem, 31000)

      await closing.closeDue()

      expect(paymentStore.payments[0]!.status).toBe('PENDING')
    })

    it('annule directement le lien quand personne n’a payé, sans rien envoyer au partenaire', async () => {
      addItem('PENDING_PAYMENT')

      const result = await closing.closeDue()
      const notified = await closing.notifyPartners()

      expect(result).toEqual({ closed: 0, cancelled: 1 })
      expect(groups.groupOrders[0]!.status).toBe('CANCELLED')
      expect(notified).toBe(0)
      expect(notifier.sent).toEqual([])
    })

    it('annonce la fermeture au groupe et prévient en privé ceux dont la commande est annulée', async () => {
      addItem('CONFIRMED')
      const unpaid = addItem('PENDING_PAYMENT')

      await closing.closeDue()

      expect(publisher.published).toEqual([
        { room: 'groupOrder:group_1', event: 'groupOrder:closed', payload: { status: 'CLOSED' } },
        {
          room: `orderItem:${unpaid}`,
          event: 'orderItem:updated',
          payload: { orderItemId: unpaid, status: 'CANCELLED', reason: 'LINK_CLOSED' },
        },
      ])
    })

    it('annonce l’annulation du lien à ceux qui l’ont ouvert', async () => {
      addItem('PENDING_PAYMENT')

      await closing.closeDue()

      expect(publisher.published[0]).toEqual({
        room: 'groupOrder:group_1',
        event: 'groupOrder:closed',
        payload: { status: 'CANCELLED' },
      })
    })

    it('ignore les liens HOST_PAYS : leur charge unique est un autre chantier, ne pas annuler des commandes « en attente » voulues', async () => {
      groups.groupOrders[0]!.paymentMode = 'HOST_PAYS'
      addItem('PENDING_PAYMENT')

      const result = await closing.closeDue()

      expect(result).toEqual({ closed: 0, cancelled: 0 })
      expect(groups.groupOrders[0]!.status).toBe('OPEN')
      expect(groups.orderItems[0]!.status).toBe('PENDING_PAYMENT')
    })

    it.each(['CLOSED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
      'ne retouche pas un lien déjà %s',
      async (status) => {
        groups.groupOrders[0]!.status = status
        addItem('PENDING_PAYMENT')

        const result = await closing.closeDue()

        expect(result).toEqual({ closed: 0, cancelled: 0 })
        expect(groups.groupOrders[0]!.status).toBe(status)
        expect(groups.orderItems[0]!.status).toBe('PENDING_PAYMENT')
      },
    )

    it('est idempotent : le passage suivant ne refait rien et n’annonce rien de plus', async () => {
      addItem('CONFIRMED')
      addItem('PENDING_PAYMENT')
      await closing.closeDue()
      const published = publisher.published.length

      const again = await closing.closeDue()

      expect(again).toEqual({ closed: 0, cancelled: 0 })
      expect(publisher.published).toHaveLength(published)
    })

    it('un lien en échec n’empêche pas de fermer les autres, et l’erreur est journalisée', async () => {
      addGroupOrder('group_2')
      addItem('CONFIRMED', 'Riz gras', 'group_1')
      addItem('CONFIRMED', 'Riz gras', 'group_2')
      store.failFor = 'group_1'

      const result = await closing.closeDue()

      expect(result).toEqual({ closed: 1, cancelled: 0 })
      expect(groups.groupOrders.map((g) => g.status)).toEqual(['OPEN', 'CLOSED'])
      expect(errors).toHaveLength(1)
    })

    it('n’annonce rien si la fermeture n’a pas pu être écrite', async () => {
      addItem('CONFIRMED')
      store.failFor = 'group_1'

      await closing.closeDue()

      expect(publisher.published).toEqual([])
    })
  })

  describe('notifyPartners', () => {
    it('transmet le récap au partenaire d’un lien fermé, avec seulement les plats payés', async () => {
      addItem('CONFIRMED', 'Riz gras')
      addItem('CONFIRMED', 'Riz gras')
      addItem('CONFIRMED', 'Attiéké poisson')
      addItem('PENDING_PAYMENT', 'Riz gras')
      addItem('CANCELLED', 'Riz gras')
      await closing.closeDue()

      const notified = await closing.notifyPartners()

      expect(notified).toBe(1)
      expect(notifier.sent).toEqual([
        {
          partner: { name: 'Chez Aïssatou', phone: '+224622000000' },
          message: [
            'Bonjour Chez Aïssatou, voici la commande TocToc à préparer :',
            '2× Riz gras',
            '1× Attiéké poisson',
            'Total : 3 plats',
            'Livraison le 21/09 à 12h00 — Kaloum Center, 3e étage',
          ].join('\n'),
        },
      ])
    })

    it('marque le récap comme transmis et ne l’envoie qu’une fois', async () => {
      addItem('CONFIRMED')
      await closing.closeDue()
      await closing.notifyPartners()

      const again = await closing.notifyPartners()

      expect(again).toBe(0)
      expect(notifier.sent).toHaveLength(1)
      expect(groups.groupOrders[0]!.partnerNotifiedAt).toEqual(current)
    })

    it('réessaie au passage suivant quand l’envoi échoue : le message ne doit jamais se perdre', async () => {
      addItem('CONFIRMED')
      await closing.closeDue()
      notifier.failWith = new Error('WhatsApp indisponible')

      const first = await closing.notifyPartners()

      expect(first).toBe(0)
      expect(groups.groupOrders[0]!.partnerNotifiedAt ?? null).toBeNull()
      expect(errors).toHaveLength(1)

      notifier.failWith = null
      const second = await closing.notifyPartners()

      expect(second).toBe(1)
      expect(notifier.sent).toHaveLength(1)
    })

    it('un envoi en échec n’empêche pas les récaps des autres liens', async () => {
      addGroupOrder('group_2', { partnerId: 'partner_2' })
      groups.partners.push({
        id: 'partner_2',
        name: 'Le Baobab',
        type: 'RESTAURANT',
        active: true,
      })
      addItem('CONFIRMED', 'Riz gras', 'group_1')
      addItem('CONFIRMED', 'Poulet', 'group_2')
      await closing.closeDue()
      store.partnerPhones.set('partner_1', '+224600000001')
      notifier.failForPhone = '+224600000001'

      const notified = await closing.notifyPartners()

      expect(notified).toBe(1)
      expect(notifier.sent.map((s) => s.partner.name)).toEqual(['Le Baobab'])
    })
  })

  describe('run', () => {
    it('ferme les liens échus puis transmet les récaps dans le même passage', async () => {
      addItem('CONFIRMED')

      const summary = await closing.run()

      expect(summary).toEqual({ closed: 1, cancelled: 0, notified: 1 })
    })
  })
})
