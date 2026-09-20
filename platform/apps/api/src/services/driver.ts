import { AppError } from '../lib/errors.js'
import { isValidPhone, normalizePhone } from '../lib/phone.js'

export interface DriverView {
  id: string
  userId: string
  name: string
  phone: string
  active: boolean
}

export type CreateDriverResult =
  | { status: 'created' | 'existing'; driver: DriverView }
  /** Le numéro est celui de l'équipe : on ne l'écrase pas. */
  | { status: 'phone_in_use' }

/** Persistance des livreurs. Prisma en production, en mémoire dans les tests. */
export interface DriverStore {
  /**
   * Le compte de ce numéro passe au rôle livreur (créé s'il n'existe pas, nom existant conservé) et
   * reçoit sa fiche livreur. Idempotent : un livreur déjà créé est renvoyé tel quel.
   */
  createDriver(input: { phone: string; name: string }): Promise<CreateDriverResult>
  listDrivers(): Promise<DriverView[]>
}

export function createDriverService(deps: { store: DriverStore; defaultCountryCode: string }) {
  const { store, defaultCountryCode } = deps

  return {
    /**
     * Crée un livreur. Il se connecte ensuite comme tout le monde, par OTP : pas de mot de passe à
     * gérer (le schéma n'en a pas), et le rôle est relu en base à chaque appel.
     */
    async createDriver(input: { phone: string; name: string }): Promise<DriverView> {
      const phone = normalizePhone(input.phone, defaultCountryCode)
      if (!isValidPhone(phone)) {
        throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
      }

      const result = await store.createDriver({ phone, name: input.name })
      if (result.status === 'phone_in_use') {
        throw new AppError(409, 'PHONE_IN_USE', 'Ce numéro est déjà utilisé par un autre compte')
      }
      return result.driver
    },

    /** Les livreurs actifs d'abord, par ordre alphabétique : la liste où l'équipe en assigne un. */
    async listDrivers(): Promise<DriverView[]> {
      return (await store.listDrivers()).sort(
        (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr'),
      )
    },
  }
}

export type DriverService = ReturnType<typeof createDriverService>
