import type { Role } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import type { OtpService } from './otp.js'

export interface AuthUser {
  id: string
  phone: string
  name: string
  role: Role
  isActive: boolean
}

/** Persistance des utilisateurs. Implémentée par Prisma en production, en mémoire dans les tests. */
export interface UserStore {
  findByPhone(phone: string): Promise<AuthUser | null>
  findById(id: string): Promise<AuthUser | null>
  create(input: { phone: string; name: string }): Promise<AuthUser>
  /**
   * Le compte de ce numéro, créé s'il n'existe pas. Atomique (deux appels simultanés ne créent
   * qu'un compte) et sans effet sur le nom d'un compte existant.
   */
  findOrCreateByPhone(input: { phone: string; name: string }): Promise<AuthUser>
}

export function createAuthService(deps: { otp: OtpService; users: UserStore }) {
  const { otp, users } = deps

  return {
    /**
     * Connexion par OTP. Le compte est créé à la première connexion (un seul flux pour
     * « s'inscrire » et « se connecter »), ce qui demande un nom : sans lui, on répond
     * NAME_REQUIRED *sans consommer le code*, pour que le client le renvoie avec le nom.
     */
    async loginWithOtp(input: {
      phone: string
      code: string
      name?: string | undefined
    }): Promise<{ user: AuthUser; isNew: boolean }> {
      const record = await otp.check(input.phone, input.code)

      const existing = await users.findByPhone(input.phone)
      if (existing && !existing.isActive) {
        throw new AppError(403, 'ACCOUNT_DISABLED', 'Compte désactivé')
      }

      const name = input.name?.trim()
      if (!existing && !name) {
        throw new AppError(422, 'NAME_REQUIRED', 'Votre nom est nécessaire pour créer le compte')
      }

      await otp.consume(record)

      if (existing) return { user: existing, isNew: false }
      return { user: await users.create({ phone: input.phone, name: name! }), isNew: true }
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
