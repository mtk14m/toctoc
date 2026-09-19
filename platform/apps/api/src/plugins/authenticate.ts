import type { FastifyRequest } from 'fastify'
import type { Role } from '../generated/prisma/enums.js'
import { AppError } from '../lib/errors.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** À mettre dans `onRequest` d'une route pour exiger un jeton valide. */
    authenticate: (req: FastifyRequest) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role }
    user: { sub: string; role: Role }
  }
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    // Jeton absent, expiré ou falsifié : même réponse, on ne dit pas lequel.
    throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise')
  }
}
