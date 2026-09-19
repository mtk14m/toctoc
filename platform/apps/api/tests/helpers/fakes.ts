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
}

export class InMemoryGroupOrderStore implements GroupOrderStore {
  partners: PartnerSummary[] = []
  menuItems: Array<MenuEntry & { partnerId: string; availableDate: Date; active: boolean }> = []
  orderItems: Array<OrderItemEntry & { groupOrderId: string }> = []
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

export class InMemoryRateLimiter implements RateLimiter {
  private counts = new Map<string, number>()

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
  return {
    otpStore: new InMemoryOtpStore(),
    userStore,
    groupOrderStore: new InMemoryGroupOrderStore(userStore),
    rateLimiter: new InMemoryRateLimiter(),
    otpSender: new RecordingOtpSender(),
  } satisfies AppDeps
}
