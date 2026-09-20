import type { AppDeps } from '../../src/deps.js'
import type { AuthUser, UserStore } from '../../src/services/auth.js'
import type { RateLimiter } from '../../src/lib/rate-limiter.js'
import type {
  GroupOrderRecord,
  GroupOrderStore,
  MenuEntry,
  NewGroupOrder,
  OrderItemEntry,
  PartnerSummary,
} from '../../src/services/group-order.js'
import type { GroupOrderStatus } from '../../src/generated/prisma/enums.js'
import type { OtpRecord, OtpSender, OtpStore } from '../../src/services/otp.js'
import type {
  AddOrderItemResult,
  JoinableGroupOrder,
  JoinableMenuItem,
  NewOrderItem,
  OrderItemStore,
} from '../../src/services/order-item.js'
import type { OrderItemPrice } from '../../src/services/pricing.js'
import type { PaymentStatus } from '../../src/generated/prisma/enums.js'
import { FakePaymentGateway } from '../../src/services/payment-gateway.js'
import type {
  PaymentInitiation,
  PaymentRecord,
  PaymentStore,
  SettleResult,
} from '../../src/services/payment.js'
import type { CloseResult, ClosingStore, RecapCandidate } from '../../src/services/closing.js'
import type { PartnerNotifier } from '../../src/services/partner-notifier.js'
import type { RestaurantRecord, RestaurantStore } from '../../src/services/restaurant.js'
import type { RatableOrderItem, RatingStore, RatingSummary } from '../../src/services/rating.js'
import type { RefundMarkResult, RefundRecord, RefundStore } from '../../src/services/refund.js'
import {
  MAX_CONFIRMATION_ATTEMPTS,
  type AssignResult,
  type AttemptResult,
  type DeliveryDetail,
  type DeliveryStore,
  type DriverRecord,
  type OpsOrderRecord,
  type OverrideResult,
  type PickUpResult,
} from '../../src/services/delivery.js'
import type { DriverStore, DriverView, CreateDriverResult } from '../../src/services/driver.js'
import type {
  DeliveryStatus,
  GroupOrderStatus as OrderStatus,
} from '../../src/generated/prisma/enums.js'
import type { RealtimePublisher, ServerToClientEvents } from '../../src/realtime/events.js'
import type {
  MenuItemRecord,
  NewMenuItem,
  NewPartner,
  PartnerPatch,
  PartnerRecord,
  PartnerStore,
} from '../../src/services/partner.js'

interface StoredOtp extends OtpRecord {
  phone: string
  expiresAt: Date
  used: boolean
  order: number
}

export class InMemoryOtpStore implements OtpStore {
  records: StoredOtp[] = []
  private sequence = 0

  async invalidatePending(phone: string): Promise<void> {
    for (const record of this.records) {
      if (record.phone === phone) record.used = true
    }
  }

  async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void> {
    this.sequence += 1
    this.records.push({
      id: `otp_${this.sequence}`,
      phone: input.phone,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      attempts: 0,
      used: false,
      order: this.sequence,
    })
  }

  async findActive(phone: string, now: Date): Promise<OtpRecord | null> {
    const active = this.records
      .filter((r) => r.phone === phone && !r.used && r.expiresAt > now)
      .sort((a, b) => b.order - a.order)[0]

    return active ? { id: active.id, codeHash: active.codeHash, attempts: active.attempts } : null
  }

  async incrementAttempts(id: string): Promise<number> {
    const record = this.records.find((r) => r.id === id)
    if (!record) throw new Error(`OTP ${id} introuvable`)
    record.attempts += 1
    return record.attempts
  }

  async consume(id: string): Promise<boolean> {
    const record = this.records.find((r) => r.id === id)
    if (!record || record.used) return false
    record.used = true
    return true
  }
}

export class InMemoryUserStore implements UserStore {
  users: AuthUser[] = []
  private sequence = 0

  async findByPhone(phone: string): Promise<AuthUser | null> {
    return this.users.find((u) => u.phone === phone) ?? null
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.users.find((u) => u.id === id) ?? null
  }

  async create(input: { phone: string; name: string }): Promise<AuthUser> {
    this.sequence += 1
    const user: AuthUser = {
      id: `user_${this.sequence}`,
      phone: input.phone,
      name: input.name,
      role: 'CLIENT',
      isActive: true,
    }
    this.users.push(user)
    return user
  }

  async findOrCreateByPhone(input: { phone: string; name: string }): Promise<AuthUser> {
    return (await this.findByPhone(input.phone)) ?? this.create(input)
  }
}

export class InMemoryGroupOrderStore implements GroupOrderStore {
  /** Les heures de service sont optionnelles dans les tests : 9h - minuit, comme le défaut du schéma. */
  partners: Array<
    Omit<PartnerSummary, 'serviceStartMinute' | 'serviceEndMinute'> &
      Partial<Pick<PartnerSummary, 'serviceStartMinute' | 'serviceEndMinute'>>
  > = []
  menuItems: Array<MenuEntry & { partnerId: string; availableDate: Date; active: boolean }> = []
  /** Les champs financiers et `userId` ne sont renseignés que par les commandes créées via `join`. */
  orderItems: Array<
    OrderItemEntry & {
      groupOrderId: string
      userId?: string
      unitPrice?: number
      deliveryFee?: number
      commissionAmount?: number
    }
  > = []
  groupOrders: Array<
    NewGroupOrder & { id: string; status: GroupOrderStatus; partnerNotifiedAt?: Date | null }
  > = []
  private sequence = 0
  /** Relié au store des notes par `createTestDeps` : la page du groupe lit la moyenne de la commande. */
  ratingOf: (groupOrderId: string) => { average: number; count: number } | null = () => null
  /** Relié au store de livraison par `createTestDeps` : la page du groupe lit l'état de la livraison. */
  deliveryOf: (
    groupOrderId: string,
  ) => { status: DeliveryStatus; confirmationCode: string | null } | null = () => null

  /** Le nom du créateur vient des utilisateurs : en base, c'est une jointure. */
  constructor(private readonly users: InMemoryUserStore) {}

  async findPartner(id: string): Promise<PartnerSummary | null> {
    const partner = this.partners.find((p) => p.id === id)
    return partner ? { serviceStartMinute: 540, serviceEndMinute: 1440, ...partner } : null
  }

  async create(input: NewGroupOrder): Promise<{ id: string; status: GroupOrderStatus }> {
    this.sequence += 1
    const record = { ...input, id: `group_${this.sequence}`, status: 'OPEN' as const }
    this.groupOrders.push(record)
    return { id: record.id, status: record.status }
  }

  async findByShareToken(shareToken: string): Promise<GroupOrderRecord | null> {
    const order = this.groupOrders.find((o) => o.shareToken === shareToken)
    if (!order) return null

    const partner = this.partners.find((p) => p.id === order.partnerId)
    const creator = this.users.users.find((u) => u.id === order.creatorId)
    if (!partner || !creator) throw new Error('Données de test incohérentes')

    return {
      id: order.id,
      status: order.status,
      deliveryAddress: order.deliveryAddress,
      orderCutoffTime: order.orderCutoffTime,
      deliveryTime: order.deliveryTime,
      paymentMode: order.paymentMode,
      creatorName: creator.name,
      partner: { id: partner.id, name: partner.name, type: partner.type },
      delivery: this.deliveryOf(order.id),
      rating: this.ratingOf(order.id),
    }
  }

  async listMenu(partnerId: string, date: Date): Promise<MenuEntry[]> {
    return this.menuItems
      .filter(
        (m) =>
          m.partnerId === partnerId && m.active && m.availableDate.getTime() === date.getTime(),
      )
      .map(({ id, name, description, price, photoUrl }) => ({
        id,
        name,
        description,
        price,
        photoUrl,
      }))
  }

  async listOrderItems(groupOrderId: string): Promise<OrderItemEntry[]> {
    return this.orderItems.filter((i) => i.groupOrderId === groupOrderId)
  }
}

export class InMemoryPartnerStore implements PartnerStore {
  partners: PartnerRecord[] = []
  menuItems: MenuItemRecord[] = []
  private sequence = 0

  async create(input: NewPartner): Promise<PartnerRecord> {
    this.sequence += 1
    const partner: PartnerRecord = {
      id: `partner_${this.sequence}`,
      name: input.name,
      type: input.type,
      phone: input.phone,
      address: input.address,
      city: input.city,
      commissionRate: input.commissionRate ?? 0.15, // le défaut du schéma Prisma
      serviceStartMinute: input.serviceStartMinute ?? 540, // 9h00, défaut du schéma Prisma
      serviceEndMinute: input.serviceEndMinute ?? 1440, // minuit
      description: input.description ?? null,
      logoUrl: input.logoUrl ?? null,
      coverUrl: input.coverUrl ?? null,
      tags: input.tags ?? [],
      active: true,
    }
    this.partners.push(partner)
    return partner
  }

  async findById(id: string): Promise<PartnerRecord | null> {
    return this.partners.find((p) => p.id === id) ?? null
  }

  async update(id: string, patch: PartnerPatch): Promise<PartnerRecord | null> {
    const partner = this.partners.find((p) => p.id === id)
    if (!partner) return null
    // Comme Prisma : une clé absente ne change rien, `null` efface.
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(partner, { [key]: value })
    }
    return partner
  }

  async exists(id: string): Promise<boolean> {
    return this.partners.some((p) => p.id === id)
  }

  async createMenuItem(input: NewMenuItem): Promise<MenuItemRecord> {
    this.sequence += 1
    const item: MenuItemRecord = {
      id: `menu_${this.sequence}`,
      partnerId: input.partnerId,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      photoUrl: input.photoUrl ?? null,
      availableDate: input.availableDate,
    }
    this.menuItems.push(item)
    return item
  }
}

/** Lit les partenaires et les plats du store partenaires : un restaurant créé par l'équipe apparaît dans l'annuaire. */
export class InMemoryRestaurantStore implements RestaurantStore {
  /** Note moyenne et nombre de notes par restaurant (le modèle Rating n'a pas encore de route). */
  ratings = new Map<string, { average: number; count: number }>()

  constructor(
    private readonly partners: InMemoryPartnerStore,
    private readonly ratingStore?: InMemoryRatingStore,
  ) {}

  async listActive(): Promise<RestaurantRecord[]> {
    return this.partners.partners.filter((p) => p.active).map(toRestaurantRecord)
  }

  async findActive(id: string): Promise<RestaurantRecord | null> {
    const partner = this.partners.partners.find((p) => p.id === id && p.active)
    return partner ? toRestaurantRecord(partner) : null
  }

  async ratingsFor(partnerIds: string[]): Promise<Map<string, { average: number; count: number }>> {
    const result = new Map([...this.ratings].filter(([id]) => partnerIds.includes(id)))
    for (const partnerId of partnerIds) {
      const scores = (this.ratingStore?.ratings ?? [])
        .filter((r) => r.partnerId === partnerId)
        .map((r) => r.score)
      if (scores.length > 0) {
        result.set(partnerId, {
          average: scores.reduce((a, b) => a + b, 0) / scores.length,
          count: scores.length,
        })
      }
    }
    return result
  }

  async menuOn(partnerIds: string[], date: Date): Promise<Map<string, MenuEntry[]>> {
    const byPartner = new Map<string, MenuEntry[]>()
    for (const item of this.partners.menuItems) {
      if (!partnerIds.includes(item.partnerId)) continue
      if (item.availableDate.getTime() !== date.getTime()) continue
      const { id, name, description, price, photoUrl } = item
      byPartner.set(item.partnerId, [
        ...(byPartner.get(item.partnerId) ?? []),
        { id, name, description, price, photoUrl },
      ])
    }
    return byPartner
  }
}

function toRestaurantRecord(partner: PartnerRecord): RestaurantRecord {
  const { id, name, type, city, description, logoUrl, coverUrl, tags } = partner
  return {
    id,
    name,
    type,
    city,
    description,
    logoUrl,
    coverUrl,
    tags,
    serviceStartMinute: partner.serviceStartMinute,
    serviceEndMinute: partner.serviceEndMinute,
  }
}

export const TEST_WEBHOOK_SECRET = 'secret-de-webhook-de-test-32-caracteres'

export interface StoredPayment {
  id: string
  orderItemId: string
  amount: number
  status: PaymentStatus
  providerTransactionId: string | null
  paidAt: Date | null
}

/** Partage l'état du store des liens : confirmer un paiement change la commande, comme en base. */
export class InMemoryPaymentStore implements PaymentStore {
  payments: StoredPayment[] = []
  private sequence = 0

  constructor(private readonly groups: InMemoryGroupOrderStore) {}

  /** Appelé par `InMemoryOrderItemStore` : en base, la même transaction crée commande et paiement. */
  createPending(orderItemId: string, amount: number): StoredPayment {
    this.sequence += 1
    const payment: StoredPayment = {
      id: `pay_${this.sequence}`,
      orderItemId,
      amount,
      status: 'PENDING',
      providerTransactionId: null,
      paidAt: null,
    }
    this.payments.push(payment)
    return payment
  }

  private orderItemOf(payment: StoredPayment) {
    const item = this.groups.orderItems.find((i) => i.id === payment.orderItemId)
    if (!item) throw new Error('Données de test incohérentes')
    return item
  }

  async findByOrderItemId(orderItemId: string): Promise<PaymentRecord | null> {
    const payment = this.payments.find((p) => p.orderItemId === orderItemId)
    return payment ? this.findById(payment.id) : null
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = this.payments.find((p) => p.id === id)
    if (!payment) return null

    const item = this.orderItemOf(payment)
    const order = this.groups.groupOrders.find((o) => o.id === item.groupOrderId)
    if (!order) throw new Error('Données de test incohérentes')

    return {
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      orderItem: {
        id: item.id,
        status: item.status,
        quantity: item.quantity,
        participantName: item.participantName,
        menuItemName: item.menuItemName,
        groupOrder: {
          id: order.id,
          status: order.status,
          orderCutoffTime: order.orderCutoffTime,
        },
      },
    }
  }

  async countActiveOrderItems(groupOrderId: string): Promise<number> {
    return this.groups.orderItems.filter(
      (i) => i.groupOrderId === groupOrderId && i.status !== 'CANCELLED',
    ).length
  }

  async settle(
    paymentId: string,
    input: {
      providerTransactionId: string
      paidAt: Date
      orderItemStatus: 'CONFIRMED' | 'CANCELLED'
    },
  ): Promise<SettleResult> {
    const payment = this.payments.find((p) => p.id === paymentId)
    if (!payment || payment.status !== 'PENDING') return { applied: false }

    payment.status = 'CONFIRMED'
    payment.providerTransactionId = input.providerTransactionId
    payment.paidAt = input.paidAt
    const item = this.orderItemOf(payment)
    const order = this.groups.groupOrders.find((o) => o.id === item.groupOrderId)
    if (item.status === 'PENDING_PAYMENT') {
      // Comme sous le verrou du lien en base : un lien qui n'est plus ouvert ne confirme plus rien.
      const stillOpen = order?.status === 'OPEN'
      item.status = input.orderItemStatus === 'CONFIRMED' && stillOpen ? 'CONFIRMED' : 'CANCELLED'
    }
    return {
      applied: true,
      orderItemStatus: item.status === 'CONFIRMED' ? 'CONFIRMED' : 'CANCELLED',
    }
  }

  async fail(paymentId: string): Promise<boolean> {
    const payment = this.payments.find((p) => p.id === paymentId)
    if (!payment || payment.status !== 'PENDING') return false

    payment.status = 'FAILED'
    const item = this.orderItemOf(payment)
    if (item.status === 'PENDING_PAYMENT') item.status = 'CANCELLED'
    return true
  }
}

/** Partage l'état du store des liens : fermer un lien change ses commandes, comme en base. */
export class InMemoryClosingStore implements ClosingStore {
  /** Téléphone du partenaire ; un numéro par défaut pour ne pas avoir à tout déclarer. */
  partnerPhones = new Map<string, string>()
  /** Fait échouer la fermeture de ce lien : une panne de base sur un lien, pas sur les autres. */
  failFor: string | null = null

  constructor(private readonly groups: InMemoryGroupOrderStore) {}

  async findDueGroupOrderIds(cutoffBefore: Date, limit: number): Promise<string[]> {
    return this.groups.groupOrders
      .filter(
        (o) =>
          o.status === 'OPEN' &&
          o.paymentMode === 'SPLIT' &&
          o.orderCutoffTime.getTime() <= cutoffBefore.getTime(),
      )
      .sort((a, b) => a.orderCutoffTime.getTime() - b.orderCutoffTime.getTime())
      .slice(0, limit)
      .map((o) => o.id)
  }

  async close(groupOrderId: string): Promise<CloseResult> {
    if (this.failFor === groupOrderId) throw new Error('base indisponible')

    const order = this.groups.groupOrders.find((o) => o.id === groupOrderId)
    if (!order || order.status !== 'OPEN') return { status: 'skipped' }

    const items = this.groups.orderItems.filter((i) => i.groupOrderId === groupOrderId)
    const unpaid = items.filter((i) => i.status === 'PENDING_PAYMENT')
    for (const item of unpaid) item.status = 'CANCELLED'

    const anyPaid = items.some((i) => i.status === 'CONFIRMED')
    order.status = anyPaid ? 'CLOSED' : 'CANCELLED'
    return {
      status: anyPaid ? 'closed' : 'cancelled',
      cancelledOrderItemIds: unpaid.map((i) => i.id),
    }
  }

  async findPendingRecaps(limit: number): Promise<RecapCandidate[]> {
    return this.groups.groupOrders
      .filter((o) => o.status === 'CLOSED' && !o.partnerNotifiedAt)
      .slice(0, limit)
      .map((order) => {
        const partner = this.groups.partners.find((p) => p.id === order.partnerId)
        if (!partner) throw new Error('Données de test incohérentes')
        return {
          groupOrderId: order.id,
          partner: {
            name: partner.name,
            phone: this.partnerPhones.get(partner.id) ?? '+224622000000',
          },
          deliveryAddress: order.deliveryAddress,
          deliveryTime: order.deliveryTime,
          items: this.groups.orderItems
            .filter((i) => i.groupOrderId === order.id && i.status === 'CONFIRMED')
            .map((i) => ({ dish: i.menuItemName, quantity: i.quantity })),
        }
      })
  }

  async markPartnerNotified(groupOrderId: string, at: Date): Promise<void> {
    const order = this.groups.groupOrders.find((o) => o.id === groupOrderId)
    if (order && !order.partnerNotifiedAt) order.partnerNotifiedAt = at
  }
}

/**
 * La livraison et les livreurs, sur l'état partagé des commandes : assigner, récupérer ou confirmer
 * change la commande, comme en base. Sans `await` entre lecture et écriture, donc atomique.
 */
export class InMemoryDeliveryStore implements DeliveryStore, DriverStore {
  drivers: Array<{ id: string; userId: string; active: boolean }> = []
  deliveries: Array<{
    id: string
    groupOrderId: string
    driverId: string | null
    status: DeliveryStatus
    confirmationCode: string | null
    confirmationAttempts: number
    pickedUpAt: Date | null
    deliveredAt: Date | null
    deliveredByOverride: boolean
  }> = []
  auditLogs: Array<{
    actorId: string
    action: string
    targetType: string
    targetId: string
    metadata: unknown
  }> = []
  /** Adresse et téléphone du restaurant, par partenaire ; des valeurs par défaut pour les tests. */
  partnerContacts = new Map<string, { address: string; phone: string }>()
  private sequence = 0

  constructor(
    private readonly groups: InMemoryGroupOrderStore,
    private readonly users: InMemoryUserStore,
  ) {}

  /** Aide de test : un compte livreur complet, prêt à être assigné. */
  async addDriver(input: { phone: string; name: string }): Promise<{ id: string; userId: string }> {
    const user = await this.users.create(input)
    user.role = 'DRIVER'
    this.sequence += 1
    const driver = { id: `driver_${this.sequence}`, userId: user.id, active: true }
    this.drivers.push(driver)
    return { id: driver.id, userId: user.id }
  }

  async findDriverById(id: string): Promise<DriverRecord | null> {
    return this.drivers.find((d) => d.id === id) ?? null
  }

  async findDriverByUserId(userId: string): Promise<DriverRecord | null> {
    return this.drivers.find((d) => d.userId === userId) ?? null
  }

  private viewOf(driver: { id: string; userId: string; active: boolean }): DriverView {
    const user = this.users.users.find((u) => u.id === driver.userId)!
    return {
      id: driver.id,
      userId: user.id,
      name: user.name,
      phone: user.phone,
      active: driver.active,
    }
  }

  async createDriver(input: { phone: string; name: string }): Promise<CreateDriverResult> {
    const user = await this.users.findOrCreateByPhone(input)
    // Le numéro de l'équipe (ou d'un autre livreur déjà promu) ne se réutilise pas en silence.
    if (user.role === 'ADMIN_PLATFORM') return { status: 'phone_in_use' }

    const existing = this.drivers.find((d) => d.userId === user.id)
    if (existing) return { status: 'existing', driver: this.viewOf(existing) }

    user.role = 'DRIVER'
    this.sequence += 1
    const driver = { id: `driver_${this.sequence}`, userId: user.id, active: true }
    this.drivers.push(driver)
    return { status: 'created', driver: this.viewOf(driver) }
  }

  async listDrivers(): Promise<DriverView[]> {
    return this.drivers.map((d) => this.viewOf(d))
  }

  private detailOf(delivery: (typeof this.deliveries)[number]): DeliveryDetail {
    const order = this.groups.groupOrders.find((o) => o.id === delivery.groupOrderId)!
    const partner = this.groups.partners.find((p) => p.id === order.partnerId)!
    const creator = this.users.users.find((u) => u.id === order.creatorId)!
    const contact = this.partnerContacts.get(partner.id) ?? {
      address: 'Almamya',
      phone: '+224622000000',
    }
    return {
      id: delivery.id,
      status: delivery.status,
      driverId: delivery.driverId,
      groupOrder: {
        id: order.id,
        deliveryAddress: order.deliveryAddress,
        deliveryTime: order.deliveryTime,
        creator: { name: creator.name, phone: creator.phone },
        restaurant: { name: partner.name, ...contact },
        items: this.groups.orderItems
          .filter((i) => i.groupOrderId === order.id && i.status === 'CONFIRMED')
          .map((i) => ({ dish: i.menuItemName, quantity: i.quantity })),
      },
    }
  }

  async assign(input: {
    groupOrderId: string
    driverId: string
    actorId: string
  }): Promise<AssignResult> {
    const order = this.groups.groupOrders.find((o) => o.id === input.groupOrderId)
    if (!order) return { status: 'order_not_found' }

    const existing = this.deliveries.find((d) => d.groupOrderId === order.id)
    if (existing && existing.status !== 'ASSIGNED') return { status: 'already_started' }
    if (!existing && order.status !== 'CLOSED') return { status: 'order_not_ready' }

    let delivery = existing
    if (!delivery) {
      this.sequence += 1
      delivery = {
        id: `delivery_${this.sequence}`,
        groupOrderId: order.id,
        driverId: input.driverId,
        status: 'ASSIGNED',
        confirmationCode: null,
        confirmationAttempts: 0,
        pickedUpAt: null,
        deliveredAt: null,
        deliveredByOverride: false,
      }
      this.deliveries.push(delivery)
    } else {
      delivery.driverId = input.driverId
    }
    this.auditLogs.push({
      actorId: input.actorId,
      action: 'delivery.driver_assigned',
      targetType: 'Delivery',
      targetId: delivery.id,
      metadata: { groupOrderId: order.id, driverId: input.driverId },
    })
    return { status: existing ? 'reassigned' : 'assigned', deliveryId: delivery.id }
  }

  async listForDriver(driverId: string): Promise<DeliveryDetail[]> {
    return this.deliveries
      .filter(
        (d) => d.driverId === driverId && (d.status === 'ASSIGNED' || d.status === 'PICKED_UP'),
      )
      .map((d) => this.detailOf(d))
      .sort((a, b) => a.groupOrder.deliveryTime.getTime() - b.groupOrder.deliveryTime.getTime())
  }

  async findForDriver(deliveryId: string, driverId: string): Promise<DeliveryDetail | null> {
    const delivery = this.deliveries.find((d) => d.id === deliveryId && d.driverId === driverId)
    return delivery ? this.detailOf(delivery) : null
  }

  async pickUp(input: {
    deliveryId: string
    driverId: string
    code: string
    at: Date
  }): Promise<PickUpResult> {
    const delivery = this.deliveries.find(
      (d) => d.id === input.deliveryId && d.driverId === input.driverId,
    )
    if (!delivery) return { status: 'not_found' }
    if (delivery.status !== 'ASSIGNED') return { status: 'invalid_state' }

    delivery.status = 'PICKED_UP'
    delivery.confirmationCode = input.code
    delivery.pickedUpAt = input.at
    const order = this.groups.groupOrders.find((o) => o.id === delivery.groupOrderId)!
    order.status = 'IN_DELIVERY'
    return { status: 'picked_up', groupOrderId: order.id, deliveryTime: order.deliveryTime }
  }

  async registerAttempt(input: { deliveryId: string; driverId: string }): Promise<AttemptResult> {
    const delivery = this.deliveries.find(
      (d) => d.id === input.deliveryId && d.driverId === input.driverId,
    )
    if (!delivery) return { status: 'not_found' }
    if (delivery.status !== 'PICKED_UP') return { status: 'invalid_state' }
    if (delivery.confirmationAttempts >= MAX_CONFIRMATION_ATTEMPTS) return { status: 'locked' }

    delivery.confirmationAttempts += 1
    return {
      status: 'counted',
      attempts: delivery.confirmationAttempts,
      code: delivery.confirmationCode!,
    }
  }

  private restaurantNameOf(groupOrderId: string): string {
    const order = this.groups.groupOrders.find((o) => o.id === groupOrderId)!
    return this.groups.partners.find((p) => p.id === order.partnerId)!.name
  }

  async complete(input: {
    deliveryId: string
    at: Date
  }): Promise<{ groupOrderId: string; restaurantName: string } | null> {
    const delivery = this.deliveries.find((d) => d.id === input.deliveryId)
    if (!delivery || delivery.status !== 'PICKED_UP') return null

    delivery.status = 'DELIVERED'
    delivery.deliveredAt = input.at
    this.groups.groupOrders.find((o) => o.id === delivery.groupOrderId)!.status = 'DELIVERED'
    return {
      groupOrderId: delivery.groupOrderId,
      restaurantName: this.restaurantNameOf(delivery.groupOrderId),
    }
  }

  async override(input: {
    deliveryId: string
    actorId: string
    reason: string
    at: Date
  }): Promise<OverrideResult> {
    const delivery = this.deliveries.find((d) => d.id === input.deliveryId)
    if (!delivery) return { status: 'not_found' }
    if (delivery.status === 'DELIVERED') return { status: 'already_delivered' }

    delivery.status = 'DELIVERED'
    delivery.deliveredAt = input.at
    delivery.deliveredByOverride = true
    this.groups.groupOrders.find((o) => o.id === delivery.groupOrderId)!.status = 'DELIVERED'
    // Jamais silencieux : le contournement laisse toujours une trace, avec sa raison.
    this.auditLogs.push({
      actorId: input.actorId,
      action: 'delivery.manual_override',
      targetType: 'Delivery',
      targetId: delivery.id,
      metadata: { reason: input.reason },
    })
    return {
      status: 'overridden',
      groupOrderId: delivery.groupOrderId,
      restaurantName: this.restaurantNameOf(delivery.groupOrderId),
    }
  }

  async listOrders(statuses: OrderStatus[]): Promise<OpsOrderRecord[]> {
    return this.groups.groupOrders
      .filter((o) => statuses.includes(o.status))
      .map((order) => {
        const delivery = this.deliveries.find((d) => d.groupOrderId === order.id)
        const driver = delivery && this.drivers.find((d) => d.id === delivery.driverId)
        return {
          id: order.id,
          status: order.status,
          restaurantName: this.groups.partners.find((p) => p.id === order.partnerId)!.name,
          deliveryAddress: order.deliveryAddress,
          orderCutoffTime: order.orderCutoffTime,
          deliveryTime: order.deliveryTime,
          items: this.groups.orderItems
            .filter((i) => i.groupOrderId === order.id && i.status === 'CONFIRMED')
            .map((i) => ({ dish: i.menuItemName, quantity: i.quantity })),
          delivery: delivery
            ? {
                id: delivery.id,
                status: delivery.status,
                driver: driver ? { id: driver.id, name: this.viewOf(driver).name } : null,
              }
            : null,
        }
      })
  }
}

/** Les notes, sur l'état partagé des commandes : noter n'est possible qu'une fois livré, comme en base. */
export class InMemoryRatingStore implements RatingStore {
  ratings: Array<{ orderItemId: string; partnerId: string; score: number }> = []

  constructor(
    private readonly groups: InMemoryGroupOrderStore,
    private readonly users: InMemoryUserStore,
  ) {}

  async findOrderItemForRating(id: string): Promise<RatableOrderItem | null> {
    const item = this.groups.orderItems.find((i) => i.id === id)
    if (!item) return null

    const order = this.groups.groupOrders.find((o) => o.id === item.groupOrderId)!
    const user = this.users.users.find((u) => u.id === item.userId)
    if (!user) return null

    return {
      id: item.id,
      status: item.status,
      userPhone: user.phone,
      groupOrder: { id: order.id, status: order.status, partnerId: order.partnerId },
    }
  }

  async create(input: {
    orderItemId: string
    partnerId: string
    score: number
  }): Promise<'created' | 'already_rated'> {
    if (this.ratings.some((r) => r.orderItemId === input.orderItemId)) return 'already_rated'
    this.ratings.push(input)
    return 'created'
  }

  async summaryForOrder(groupOrderId: string): Promise<RatingSummary | null> {
    const scores = this.ratings
      .filter(
        (r) =>
          this.groups.orderItems.find((i) => i.id === r.orderItemId)?.groupOrderId === groupOrderId,
      )
      .map((r) => r.score)
    if (scores.length === 0) return null
    return { average: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length }
  }
}

/** Les paiements encaissés sans repas : lit les paiements et les parts, et garde son journal d'audit. */
export class InMemoryRefundStore implements RefundStore {
  auditLogs: Array<{
    actorId: string
    action: string
    targetType: string
    targetId: string
    metadata: unknown
  }> = []

  constructor(
    private readonly groups: InMemoryGroupOrderStore,
    private readonly users: InMemoryUserStore,
    private readonly payments: InMemoryPaymentStore,
  ) {}

  private isRefunded(orderItemId: string): boolean {
    return this.auditLogs.some(
      (log) => log.action === 'order_item.refunded' && log.targetId === orderItemId,
    )
  }

  async listPending(): Promise<RefundRecord[]> {
    const records: RefundRecord[] = []
    for (const payment of this.payments.payments) {
      const item = this.groups.orderItems.find((i) => i.id === payment.orderItemId)
      if (!item || item.status !== 'CANCELLED' || payment.status !== 'CONFIRMED') continue
      if (this.isRefunded(item.id)) continue

      const order = this.groups.groupOrders.find((o) => o.id === item.groupOrderId)!
      const user = this.users.users.find((u) => u.id === item.userId)!
      records.push({
        orderItemId: item.id,
        paymentId: payment.id,
        groupOrderId: order.id,
        restaurantName: this.groups.partners.find((p) => p.id === order.partnerId)!.name,
        amount: payment.amount,
        currency: 'GNF',
        paidAt: payment.paidAt,
        providerTransactionId: payment.providerTransactionId,
        participant: { name: item.participantName, phone: user.phone },
      })
    }
    return records
  }

  async markRefunded(input: {
    orderItemId: string
    actorId: string
    reference: string
  }): Promise<RefundMarkResult> {
    const item = this.groups.orderItems.find((i) => i.id === input.orderItemId)
    if (!item) return { status: 'not_found' }
    if (this.isRefunded(item.id)) return { status: 'already_refunded' }

    const payment = this.payments.payments.find((p) => p.orderItemId === item.id)
    if (!payment || payment.status !== 'CONFIRMED' || item.status !== 'CANCELLED') {
      return { status: 'not_refundable' }
    }

    this.auditLogs.push({
      actorId: input.actorId,
      action: 'order_item.refunded',
      targetType: 'OrderItem',
      targetId: item.id,
      metadata: { paymentId: payment.id, amount: payment.amount, reference: input.reference },
    })
    return { status: 'recorded' }
  }
}

export class RecordingPartnerNotifier implements PartnerNotifier {
  sent: Array<{ partner: { name: string; phone: string }; message: string }> = []
  /** Tout envoi échoue. */
  failWith: Error | null = null
  /** Seuls les envois vers ce numéro échouent. */
  failForPhone: string | null = null

  async sendRecap(partner: { name: string; phone: string }, message: string): Promise<void> {
    if (this.failWith) throw this.failWith
    if (partner.phone === this.failForPhone) throw new Error('WhatsApp indisponible')
    this.sent.push({ partner, message })
  }
}

/** Garde trace de ce qui serait diffusé, sans serveur Socket.io. */
export class RecordingPublisher implements RealtimePublisher {
  published: Array<{ room: string; event: string; payload: unknown }> = []

  publish<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.published.push({ room, event, payload: args[0] })
  }
}

/** Le vrai calcul de signature (celui de la passerelle de dev), avec une trace des initiations. */
export class RecordingPaymentGateway extends FakePaymentGateway {
  initiated: PaymentInitiation[] = []
  failWith: Error | null = null

  constructor(webhookSecret = TEST_WEBHOOK_SECRET) {
    super({ webhookSecret })
  }

  override async initiate(input: PaymentInitiation): Promise<void> {
    if (this.failWith) throw this.failWith
    this.initiated.push(input)
  }
}

/**
 * Les commandes partagent l'état du store des liens : une commande créée par `join` apparaît
 * ensuite sur la page publique du lien, comme en base.
 */
export class InMemoryOrderItemStore implements OrderItemStore {
  /** Taux de commission par partenaire ; 15 % par défaut, comme le schéma Prisma. */
  commissionRates = new Map<string, number>()
  private sequence = 0

  constructor(
    private readonly groups: InMemoryGroupOrderStore,
    private readonly users: InMemoryUserStore,
    private readonly payments: InMemoryPaymentStore,
  ) {}

  async findGroupOrderForJoin(shareToken: string): Promise<JoinableGroupOrder | null> {
    const order = this.groups.groupOrders.find((o) => o.shareToken === shareToken)
    if (!order) return null

    return {
      id: order.id,
      status: order.status,
      orderCutoffTime: order.orderCutoffTime,
      deliveryTime: order.deliveryTime,
      paymentMode: order.paymentMode,
      partner: {
        id: order.partnerId,
        commissionRate: this.commissionRates.get(order.partnerId) ?? 0.15,
      },
    }
  }

  async findMenuItem(id: string): Promise<JoinableMenuItem | null> {
    const item = this.groups.menuItems.find((m) => m.id === id)
    if (!item) return null

    const { partnerId, name, price, active, availableDate } = item
    return { id, partnerId, name, price, active, availableDate }
  }

  /** Sans `await` entre la lecture et l'écriture : atomique, comme le verrou de la version Prisma. */
  async addOrderItem(
    input: NewOrderItem,
    pricer: (existingActiveOrderItems: number) => OrderItemPrice,
  ): Promise<AddOrderItemResult> {
    const order = this.groups.groupOrders.find((o) => o.id === input.groupOrderId)
    if (!order || order.status !== 'OPEN') return { status: 'closed' }

    const active = this.groups.orderItems.filter(
      (i) => i.groupOrderId === input.groupOrderId && i.status !== 'CANCELLED',
    )
    if (active.some((i) => i.userId === input.userId)) return { status: 'already_joined' }

    const price = pricer(active.length)
    const user = this.users.users.find((u) => u.id === input.userId)
    const menuItem = this.groups.menuItems.find((m) => m.id === input.menuItemId)
    if (!user || !menuItem) throw new Error('Données de test incohérentes')

    this.sequence += 1
    const item = {
      id: `item_${this.sequence}`,
      groupOrderId: input.groupOrderId,
      userId: input.userId,
      participantName: user.name,
      menuItemName: menuItem.name,
      quantity: input.quantity,
      status: 'PENDING_PAYMENT' as const,
      unitPrice: price.unitPrice,
      deliveryFee: price.deliveryFee,
      commissionAmount: price.commissionAmount,
    }
    this.groups.orderItems.push(item)
    const paymentId = input.createPayment
      ? this.payments.createPending(item.id, price.amount).id
      : null
    return { status: 'created', item: { id: item.id, status: item.status }, price, paymentId }
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  private counts = new Map<string, number>()

  /** Les clés utilisées jusqu'ici : permet de vérifier ce qui est compté (par téléphone, par IP...). */
  get keys(): string[] {
    return [...this.counts.keys()]
  }

  async hit(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, count)
    return count
  }
}

export class RecordingOtpSender implements OtpSender {
  sent: Array<{ phone: string; code: string }> = []
  failWith: Error | null = null

  async send(phone: string, code: string): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push({ phone, code })
  }

  get last(): { phone: string; code: string } {
    const last = this.sent.at(-1)
    if (!last) throw new Error('Aucun OTP envoyé')
    return last
  }
}

export function createTestDeps() {
  const userStore = new InMemoryUserStore()
  const groupOrderStore = new InMemoryGroupOrderStore(userStore)
  const paymentStore = new InMemoryPaymentStore(groupOrderStore)
  const partnerStore = new InMemoryPartnerStore()
  const deliveryStore = new InMemoryDeliveryStore(groupOrderStore, userStore)
  const ratingStore = new InMemoryRatingStore(groupOrderStore, userStore)
  groupOrderStore.ratingOf = (groupOrderId) => {
    const scores = ratingStore.ratings
      .filter(
        (r) =>
          groupOrderStore.orderItems.find((i) => i.id === r.orderItemId)?.groupOrderId ===
          groupOrderId,
      )
      .map((r) => r.score)
    return scores.length > 0
      ? { average: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length }
      : null
  }
  groupOrderStore.deliveryOf = (groupOrderId) => {
    const delivery = deliveryStore.deliveries.find((d) => d.groupOrderId === groupOrderId)
    return delivery
      ? { status: delivery.status, confirmationCode: delivery.confirmationCode }
      : null
  }
  return {
    otpStore: new InMemoryOtpStore(),
    userStore,
    groupOrderStore,
    orderItemStore: new InMemoryOrderItemStore(groupOrderStore, userStore, paymentStore),
    paymentStore,
    paymentGateway: new RecordingPaymentGateway(),
    closingStore: new InMemoryClosingStore(groupOrderStore),
    partnerNotifier: new RecordingPartnerNotifier(),
    partnerStore,
    restaurantStore: new InMemoryRestaurantStore(partnerStore, ratingStore),
    ratingStore,
    refundStore: new InMemoryRefundStore(groupOrderStore, userStore, paymentStore),
    deliveryStore,
    driverStore: deliveryStore,
    rateLimiter: new InMemoryRateLimiter(),
    otpSender: new RecordingOtpSender(),
  } satisfies AppDeps
}
