import type { PrismaClient } from '../generated/prisma/client.js'
import type { AuthUser, UserStore } from '../services/auth.js'

const select = { id: true, phone: true, name: true, role: true, isActive: true } as const

export class PrismaUserStore implements UserStore {
  constructor(private readonly db: PrismaClient) {}

  findByPhone(phone: string): Promise<AuthUser | null> {
    return this.db.user.findUnique({ where: { phone }, select })
  }

  findById(id: string): Promise<AuthUser | null> {
    return this.db.user.findUnique({ where: { id }, select })
  }

  create(input: { phone: string; name: string }): Promise<AuthUser> {
    return this.db.user.create({ data: input, select })
  }
}
