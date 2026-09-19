import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors.js'
import { fail } from '../lib/response.js'

/**
 * Toute erreur sort dans l'enveloppe { success: false, error: { code, message } },
 * pour que le frontend traite les échecs de façon générique.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send(fail('NOT_FOUND', 'Ressource introuvable'))
  })

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      // Une erreur serveur voulue (ex. fournisseur d'envoi en panne) garde sa cause dans les logs.
      if (error.statusCode >= 500) req.log.error({ err: error }, error.code)
      return reply.status(error.statusCode).send(fail(error.code, error.message, error.details))
    }

    if (error instanceof ZodError) {
      const details = error.issues.map(({ path, message, code }) => ({ path, message, code }))
      return reply.status(400).send(fail('VALIDATION_ERROR', 'Données invalides', details))
    }

    // Erreurs client levées par Fastify lui-même (JSON invalide, corps trop gros...)
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(fail('BAD_REQUEST', 'Requête invalide'))
    }

    // Le détail reste dans les logs : on ne le renvoie jamais au client.
    req.log.error({ err: error }, 'Erreur non gérée')
    return reply.status(500).send(fail('INTERNAL_ERROR', 'Erreur interne du serveur'))
  })
}
