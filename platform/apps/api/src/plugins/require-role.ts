import type { FastifyRequest } from 'fastify'
import type { Role } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'
import type { UserStore } from '../services/auth.js'
import { authenticate } from './authenticate.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** À mettre dans `onRequest` : jeton valide ET l'un des rôles donnés. */
    requireRole: (...roles: Role[]) => (req: FastifyRequest) => Promise<void>
  }
}

/**
 * Le rôle est relu en base à chaque appel, pas lu dans le jeton : un jeton dure 7 jours, et un
 * admin rétrogradé ou désactivé ne doit pas garder ses droits jusque-là.
 */
export function createRequireRole(users: UserStore) {
  return (...roles: Role[]) =>
    async (req: FastifyRequest): Promise<void> => {
      await authenticate(req)

      const user = await users.findById(req.user.sub)
      if (!user || !user.isActive) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise')
      }
      if (!roles.includes(user.role)) {
        throw new AppError(403, 'FORBIDDEN', 'Accès refusé')
      }
    }
}
