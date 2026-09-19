/**
 * Erreur métier attendue : le code est stable (le frontend s'appuie dessus),
 * le message est destiné à l'utilisateur.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
