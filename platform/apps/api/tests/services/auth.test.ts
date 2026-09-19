import { beforeEach, describe, expect, it } from 'vitest'
import { createAuthService } from '../../src/services/auth.js'
import { createOtpService } from '../../src/services/otp.js'
import {
  InMemoryOtpStore,
  InMemoryRateLimiter,
  InMemoryUserStore,
  RecordingOtpSender,
} from '../helpers/fakes.js'

const PHONE = '+224621000000'
const CODE = '123456'

describe('AuthService.loginWithOtp', () => {
  let otpStore: InMemoryOtpStore
  let users: InMemoryUserStore
  let sender: RecordingOtpSender
  let otp: ReturnType<typeof createOtpService>
  let auth: ReturnType<typeof createAuthService>

  beforeEach(async () => {
    otpStore = new InMemoryOtpStore()
    users = new InMemoryUserStore()
    sender = new RecordingOtpSender()
    otp = createOtpService({
      store: otpStore,
      sender,
      rateLimiter: new InMemoryRateLimiter(),
      secret: 'secret-de-test-secret-de-test-1234',
      generateCode: () => CODE,
    })
    auth = createAuthService({ otp, users })
    await otp.request(PHONE)
  })

  it('connecte un utilisateur existant', async () => {
    const existing = await users.create({ phone: PHONE, name: 'Aïcha' })

    const result = await auth.loginWithOtp({ phone: PHONE, code: CODE })

    expect(result).toEqual({ user: existing, isNew: false })
  })

  it('crée le compte à la première connexion, en CLIENT, avec le nom fourni', async () => {
    const result = await auth.loginWithOtp({ phone: PHONE, code: CODE, name: '  Mamadou Diallo ' })

    expect(result.isNew).toBe(true)
    expect(result.user).toMatchObject({ phone: PHONE, name: 'Mamadou Diallo', role: 'CLIENT' })
    expect(users.users).toHaveLength(1)
  })

  it('demande le nom (422) à un nouvel utilisateur, sans consommer le code', async () => {
    await expect(auth.loginWithOtp({ phone: PHONE, code: CODE })).rejects.toMatchObject({
      statusCode: 422,
      code: 'NAME_REQUIRED',
    })
    expect(users.users).toHaveLength(0)

    // Le même code sert encore : le client renvoie le formulaire avec le nom.
    const retry = await auth.loginWithOtp({ phone: PHONE, code: CODE, name: 'Mamadou' })
    expect(retry.isNew).toBe(true)
  })

  it('refuse un nom vide ou fait d’espaces', async () => {
    await expect(
      auth.loginWithOtp({ phone: PHONE, code: CODE, name: '   ' }),
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' })
  })

  it('refuse un mauvais code sans créer de compte', async () => {
    await expect(
      auth.loginWithOtp({ phone: PHONE, code: '000000', name: 'Mamadou' }),
    ).rejects.toMatchObject({ code: 'INVALID_OTP' })
    expect(users.users).toHaveLength(0)
  })

  it('refuse un compte désactivé (403)', async () => {
    const user = await users.create({ phone: PHONE, name: 'Aïcha' })
    user.isActive = false

    await expect(auth.loginWithOtp({ phone: PHONE, code: CODE })).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_DISABLED',
    })
  })

  it('un code ne sert qu’une fois : la seconde connexion avec le même code échoue', async () => {
    await users.create({ phone: PHONE, name: 'Aïcha' })

    await auth.loginWithOtp({ phone: PHONE, code: CODE })

    await expect(auth.loginWithOtp({ phone: PHONE, code: CODE })).rejects.toMatchObject({
      code: 'INVALID_OTP',
    })
  })
})
