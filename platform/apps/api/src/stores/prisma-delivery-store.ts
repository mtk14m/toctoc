import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { GroupOrderStatus } from '../generated/prisma/enums.js'
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
} from '../services/delivery.js'
import type { CreateDriverResult, DriverStore, DriverView } from '../services/driver.js'

type Tx = Prisma.TransactionClient

const detailSelect = {
  id: true,
  status: true,
  driverId: true,
  groupOrder: {
    select: {
      id: true,
      deliveryAddress: true,
      deliveryTime: true,
      creator: { select: { name: true, phone: true } },
      partner: { select: { name: true, address: true, phone: true } },
      orderItems: {
        where: { status: 'CONFIRMED' },
        select: { quantity: true, menuItem: { select: { name: true } } },
      },
    },
  },
} as const

type DetailRow = Prisma.DeliveryGetPayload<{ select: typeof detailSelect }>

function toDetail(row: DetailRow): DeliveryDetail {
  const { groupOrder } = row
  return {
    id: row.id,
    status: row.status,
    driverId: row.driverId,
    groupOrder: {
      id: groupOrder.id,
      deliveryAddress: groupOrder.deliveryAddress,
      deliveryTime: groupOrder.deliveryTime,
      creator: groupOrder.creator,
      restaurant: groupOrder.partner,
      items: groupOrder.orderItems.map((item) => ({
        dish: item.menuItem.name,
        quantity: item.quantity,
      })),
    },
  }
}

export class PrismaDeliveryStore implements DeliveryStore, DriverStore {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Le verrou de la commande, le même que `join`, les paiements et la clôture : toutes les
   * transitions de livraison s'y sérialisent. Renvoie faux si la commande n'existe pas.
   */
  private async lockOrder(tx: Tx, groupOrderId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId} FOR UPDATE`
    return rows.length > 0
  }

  findDriverById(id: string): Promise<DriverRecord | null> {
    return this.db.driver.findUnique({
      where: { id },
      select: { id: true, userId: true, active: true },
    })
  }

  findDriverByUserId(userId: string): Promise<DriverRecord | null> {
    return this.db.driver.findUnique({
      where: { userId },
      select: { id: true, userId: true, active: true },
    })
  }

  async createDriver(input: { phone: string; name: string }): Promise<CreateDriverResult> {
    const toView = (driver: {
      id: string
      active: boolean
      user: { id: string; name: string; phone: string }
    }): DriverView => ({
      id: driver.id,
      userId: driver.user.id,
      name: driver.user.name,
      phone: driver.user.phone,
      active: driver.active,
    })
    const driverSelect = {
      id: true,
      active: true,
      user: { select: { id: true, name: true, phone: true } },
    } as const

    try {
      return await this.db.$transaction(async (tx) => {
        // `update` vide : un compte existant garde son nom.
        const user = await tx.user.upsert({
          where: { phone: input.phone },
          update: {},
          create: input,
          select: { id: true, role: true },
        })
        // Le numéro de l'équipe ne se réutilise pas en silence.
        if (user.role === 'ADMIN_PLATFORM') return { status: 'phone_in_use' as const }

        const existing = await tx.driver.findUnique({
          where: { userId: user.id },
          select: driverSelect,
        })
        if (existing) return { status: 'existing' as const, driver: toView(existing) }

        await tx.user.update({ where: { id: user.id }, data: { role: 'DRIVER' } })
        const driver = await tx.driver.create({ data: { userId: user.id }, select: driverSelect })
        return { status: 'created' as const, driver: toView(driver) }
      })
    } catch (error) {
      // P2002 : deux créations simultanées du même numéro, l'autre a gagné — on renvoie son livreur.
      if ((error as { code?: string }).code !== 'P2002') throw error
      const driver = await this.db.driver.findFirst({
        where: { user: { phone: input.phone } },
        select: driverSelect,
      })
      if (!driver) throw error
      return { status: 'existing', driver: toView(driver) }
    }
  }

  async listDrivers(): Promise<DriverView[]> {
    const drivers = await this.db.driver.findMany({
      select: { id: true, active: true, user: { select: { id: true, name: true, phone: true } } },
    })
    return drivers.map((driver) => ({
      id: driver.id,
      userId: driver.user.id,
      name: driver.user.name,
      phone: driver.user.phone,
      active: driver.active,
    }))
  }

  assign(input: {
    groupOrderId: string
    driverId: string
    actorId: string
  }): Promise<AssignResult> {
    return this.db.$transaction(async (tx) => {
      if (!(await this.lockOrder(tx, input.groupOrderId))) {
        return { status: 'order_not_found' as const }
      }

      const [order, existing] = await Promise.all([
        tx.groupOrder.findUniqueOrThrow({
          where: { id: input.groupOrderId },
          select: { status: true },
        }),
        tx.delivery.findUnique({
          where: { groupOrderId: input.groupOrderId },
          select: { id: true, status: true },
        }),
      ])
      if (existing && existing.status !== 'ASSIGNED') return { status: 'already_started' as const }
      if (!existing && order.status !== 'CLOSED') return { status: 'order_not_ready' as const }

      const delivery = existing
        ? await tx.delivery.update({
            where: { id: existing.id },
            data: { driverId: input.driverId },
            select: { id: true },
          })
        : await tx.delivery.create({
            data: { groupOrderId: input.groupOrderId, driverId: input.driverId },
            select: { id: true },
          })

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'delivery.driver_assigned',
          targetType: 'Delivery',
          targetId: delivery.id,
          metadata: { groupOrderId: input.groupOrderId, driverId: input.driverId },
        },
      })
      return {
        status: existing ? ('reassigned' as const) : ('assigned' as const),
        deliveryId: delivery.id,
      }
    })
  }

  async listForDriver(driverId: string): Promise<DeliveryDetail[]> {
    const rows = await this.db.delivery.findMany({
      where: { driverId, status: { in: ['ASSIGNED', 'PICKED_UP'] } },
      orderBy: { groupOrder: { deliveryTime: 'asc' } },
      select: detailSelect,
    })
    return rows.map(toDetail)
  }

  async findForDriver(deliveryId: string, driverId: string): Promise<DeliveryDetail | null> {
    const row = await this.db.delivery.findFirst({
      where: { id: deliveryId, driverId },
      select: detailSelect,
    })
    return row && toDetail(row)
  }

  pickUp(input: {
    deliveryId: string
    driverId: string
    code: string
    at: Date
  }): Promise<PickUpResult> {
    return this.db.$transaction(async (tx) => {
      const ref = await tx.delivery.findFirst({
        where: { id: input.deliveryId, driverId: input.driverId },
        select: { groupOrderId: true },
      })
      if (!ref) return { status: 'not_found' as const }
      await this.lockOrder(tx, ref.groupOrderId)

      // `status: 'ASSIGNED'` dans le filtre : un seul de deux appels simultanés récupère les plats.
      const { count } = await tx.delivery.updateMany({
        where: { id: input.deliveryId, driverId: input.driverId, status: 'ASSIGNED' },
        data: { status: 'PICKED_UP', confirmationCode: input.code, pickedUpAt: input.at },
      })
      if (count !== 1) return { status: 'invalid_state' as const }

      const order = await tx.groupOrder.update({
        where: { id: ref.groupOrderId },
        data: { status: 'IN_DELIVERY' },
        select: { deliveryTime: true },
      })
      return {
        status: 'picked_up' as const,
        groupOrderId: ref.groupOrderId,
        deliveryTime: order.deliveryTime,
      }
    })
  }

  registerAttempt(input: { deliveryId: string; driverId: string }): Promise<AttemptResult> {
    return this.db.$transaction(async (tx) => {
      const ref = await tx.delivery.findFirst({
        where: { id: input.deliveryId, driverId: input.driverId },
        select: { groupOrderId: true },
      })
      if (!ref) return { status: 'not_found' as const }
      // Sous verrou : deux essais simultanés ne peuvent pas lire le même compteur.
      await this.lockOrder(tx, ref.groupOrderId)

      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id: input.deliveryId },
        select: { status: true, confirmationAttempts: true, confirmationCode: true },
      })
      if (delivery.status !== 'PICKED_UP' || delivery.confirmationCode === null) {
        return { status: 'invalid_state' as const }
      }
      if (delivery.confirmationAttempts >= MAX_CONFIRMATION_ATTEMPTS) {
        return { status: 'locked' as const }
      }

      const { confirmationAttempts } = await tx.delivery.update({
        where: { id: input.deliveryId },
        data: { confirmationAttempts: { increment: 1 } },
        select: { confirmationAttempts: true },
      })
      return {
        status: 'counted' as const,
        attempts: confirmationAttempts,
        code: delivery.confirmationCode,
      }
    })
  }

  complete(input: { deliveryId: string; at: Date }): Promise<{ groupOrderId: string } | null> {
    return this.db.$transaction(async (tx) => {
      const ref = await tx.delivery.findUnique({
        where: { id: input.deliveryId },
        select: { groupOrderId: true },
      })
      if (!ref) return null
      await this.lockOrder(tx, ref.groupOrderId)

      const { count } = await tx.delivery.updateMany({
        where: { id: input.deliveryId, status: 'PICKED_UP' },
        data: { status: 'DELIVERED', deliveredAt: input.at },
      })
      if (count !== 1) return null

      await tx.groupOrder.update({ where: { id: ref.groupOrderId }, data: { status: 'DELIVERED' } })
      return { groupOrderId: ref.groupOrderId }
    })
  }

  override(input: {
    deliveryId: string
    actorId: string
    reason: string
    at: Date
  }): Promise<OverrideResult> {
    return this.db.$transaction(async (tx) => {
      const ref = await tx.delivery.findUnique({
        where: { id: input.deliveryId },
        select: { groupOrderId: true },
      })
      if (!ref) return { status: 'not_found' as const }
      await this.lockOrder(tx, ref.groupOrderId)

      const { count } = await tx.delivery.updateMany({
        where: { id: input.deliveryId, status: { not: 'DELIVERED' } },
        data: { status: 'DELIVERED', deliveredAt: input.at, deliveredByOverride: true },
      })
      if (count !== 1) return { status: 'already_delivered' as const }

      await tx.groupOrder.update({ where: { id: ref.groupOrderId }, data: { status: 'DELIVERED' } })
      // Dans la même transaction : un contournement sans trace ne peut pas exister.
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'delivery.manual_override',
          targetType: 'Delivery',
          targetId: input.deliveryId,
          metadata: { reason: input.reason },
        },
      })
      return { status: 'overridden' as const, groupOrderId: ref.groupOrderId }
    })
  }

  async listOrders(statuses: GroupOrderStatus[]): Promise<OpsOrderRecord[]> {
    const orders = await this.db.groupOrder.findMany({
      where: { status: { in: statuses } },
      orderBy: { deliveryTime: 'asc' },
      select: {
        id: true,
        status: true,
        deliveryAddress: true,
        orderCutoffTime: true,
        deliveryTime: true,
        partner: { select: { name: true } },
        orderItems: {
          where: { status: 'CONFIRMED' },
          select: { quantity: true, menuItem: { select: { name: true } } },
        },
        delivery: {
          select: {
            id: true,
            status: true,
            driver: { select: { id: true, user: { select: { name: true } } } },
          },
        },
      },
    })

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      restaurantName: order.partner.name,
      deliveryAddress: order.deliveryAddress,
      orderCutoffTime: order.orderCutoffTime,
      deliveryTime: order.deliveryTime,
      items: order.orderItems.map((item) => ({
        dish: item.menuItem.name,
        quantity: item.quantity,
      })),
      delivery: order.delivery && {
        id: order.delivery.id,
        status: order.delivery.status,
        driver: order.delivery.driver && {
          id: order.delivery.driver.id,
          name: order.delivery.driver.user.name,
        },
      },
    }))
  }
}
