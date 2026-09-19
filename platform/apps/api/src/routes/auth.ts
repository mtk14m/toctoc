import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { isValidPhone, normalizePhone } from '../lib/phone.js'
import { ok } from '../lib/response.js'
import type { AuthService, AuthUser, UserStore } from '../services/auth.js'
import type { OtpService } from '../services/otp.js'

// La forme exacte du numéro est jugée par isValidPhone (erreur INVALID_PHONE, plus parlante).
const phoneField = z.string().min(1).max(25)

const requestOtpSchema = z.object({ phone: phoneField })
const verifyOtpSchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'le code a 6 chiffres'),
  name: z.string().max(100).optional(),
})

export interface AuthRoutesOptions {
  otp: OtpService
  authService: AuthService
  userStore: UserStore
  defaultCountryCode: string
}

/** Ce que l'API expose d'un utilisateur : rien d'interne. */
function publicUser({ id, phone, name, role }: AuthUser) {
  return { id, phone, name, role }
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const { otp, authService, userStore, defaultCountryCode } = options

  function parsePhone(raw: string): string {
    const phone = normalizePhone(raw, defaultCountryCode)
    if (!isValidPhone(phone)) {
      throw new AppError(400, 'INVALID_PHONE', 'Numéro de téléphone invalide')
    }
    return phone
  }

  // Même réponse que le numéro soit connu ou non : on ne permet pas de sonder les comptes.
  app.post('/otp/request', async (req) => {
    const body = requestOtpSchema.parse(req.body)
    await otp.request(parsePhone(body.phone))
    return ok({ message: 'Code envoyé' })
  })

  app.post('/otp/verify', async (req) => {
    const body = verifyOtpSchema.parse(req.body)
    const { user, isNew } = await authService.loginWithOtp({
      phone: parsePhone(body.phone),
      code: body.code,
      name: body.name,
    })

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role })
    return ok({ accessToken, user: publicUser(user), isNew })
  })

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await userStore.findById(req.user.sub)
    // Un jeton reste valide jusqu'à son expiration : on revérifie que le compte est toujours actif.
    if (!user || !user.isActive) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise')
    }
    return ok({ user: publicUser(user) })
  })
}
