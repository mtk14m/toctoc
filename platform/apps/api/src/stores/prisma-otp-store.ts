import type { PrismaClient } from '../generated/prisma/client.js'
import type { OtpRecord, OtpStore } from '../services/otp.js'

export class PrismaOtpStore implements OtpStore {
  constructor(private readonly db: PrismaClient) {}

  async invalidatePending(phone: string): Promise<void> {
    await this.db.otpCode.updateMany({ where: { phone, used: false }, data: { used: true } })
  }

  async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await this.db.otpCode.create({ data: input })
  }

  async findActive(phone: string, now: Date): Promise<OtpRecord | null> {
    return this.db.otpCode.findFirst({
      where: { phone, used: false, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, attempts: true },
    })
  }

  async incrementAttempts(id: string): Promise<number> {
    const { attempts } = await this.db.otpCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    })
    return attempts
  }

  async consume(id: string): Promise<boolean> {
    // updateMany avec `used: false` dans le filtre : la base garantit qu'un seul appel gagne.
    const { count } = await this.db.otpCode.updateMany({
      where: { id, used: false },
      data: { used: true },
    })
    return count === 1
  }
}
