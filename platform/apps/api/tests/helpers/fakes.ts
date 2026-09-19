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
import type { PaymentInitiation, PaymentRecord, PaymentStore } from '../../src/services/payment.js'
import type { RealtimePublisher, ServerToClientEvents } from '../../src/realtime/events.js'
import type {
  MenuItemRecord,
  NewMenuItem,
  NewPartner,
  PartnerListItem,
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
  partners: PartnerSummary[] = []
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
  groupOrders: Array<NewGroupOrder & { id: string; status: GroupOrderStatus }> = []
  private sequence = 0

  /** Le nom du créateur vient des utilisateurs : en base, c'est une jointure. */
  constructor(private readonly users: InMemoryUserStore) {}

  async findPartner(id: string): Promise<PartnerSummary | null> {
    return this.partners.find((p) => p.id === id) ?? null
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
      active: true,
    }
    this.partners.push(partner)
    return partner
  }

  async listActive(): Promise<PartnerListItem[]> {
    return this.partners
      .filter((p) => p.active)
      .map(({ id, name, type, city }) => ({ id, name, type, city }))
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
  ): Promise<boolean> {
    const payment = this.payments.find((p) => p.id === paymentId)
    if (!payment || payment.status !== 'PENDING') return false

    payment.status = 'CONFIRMED'
    payment.providerTransactionId = input.providerTransactionId
    payment.paidAt = input.paidAt
    const item = this.orderItemOf(payment)
    if (item.status === 'PENDING_PAYMENT') item.status = input.orderItemStatus
    return true
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
  return {
    otpStore: new InMemoryOtpStore(),
    userStore,
    groupOrderStore,
    orderItemStore: new InMemoryOrderItemStore(groupOrderStore, userStore, paymentStore),
    paymentStore,
    paymentGateway: new RecordingPaymentGateway(),
    partnerStore: new InMemoryPartnerStore(),
    rateLimiter: new InMemoryRateLimiter(),
    otpSender: new RecordingOtpSender(),
  } satisfies AppDeps
}
