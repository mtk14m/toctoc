import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { AppError } from '../lib/errors.js'
import type { RateLimiter } from '../lib/rate-limiter.js'
import { redisKeys } from '../lib/redis-keys.js'

export const OTP_TTL_MS = 5 * 60 * 1000
export const MAX_OTP_REQUESTS = 3
export const OTP_REQUEST_WINDOW_SECONDS = 10 * 60
export const MAX_OTP_ATTEMPTS = 5

export interface OtpRecord {
  id: string
  codeHash: string
  attempts: number
}

/** Persistance des codes. Implémentée par Prisma en production, en mémoire dans les tests. */
export interface OtpStore {
  /** Marque comme utilisés tous les codes en attente de ce numéro. */
  invalidatePending(phone: string): Promise<void>
  create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void>
  /** Le code le plus récent, non utilisé et non expiré. */
  findActive(phone: string, now: Date): Promise<OtpRecord | null>
  /** Renvoie le nombre d'essais ratés après incrément. */
  incrementAttempts(id: string): Promise<number>
  /** Vrai seulement pour l'appel qui a effectivement consommé le code (atomique). */
  consume(id: string): Promise<boolean>
}

/** Canal d'envoi du code : console aujourd'hui, WhatsApp / SMS demain. */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>
}

/** Code à 6 chiffres tiré par le générateur cryptographique de Node (pas Math.random). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function hashCode(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// Une seule erreur pour « inconnu », « expiré », « bloqué » et « faux » : on ne révèle rien.
const invalidOtp = () => new AppError(401, 'INVALID_OTP', 'Code invalide ou expiré')

export interface OtpServiceDeps {
  store: OtpStore
  sender: OtpSender
  rateLimiter: RateLimiter
  /** Clé de l'HMAC : sans elle, une fuite de la base ne permet pas de retrouver les codes. */
  secret: string
  now?: () => Date
  generateCode?: () => string
}

export function createOtpService(deps: OtpServiceDeps) {
  const { store, sender, rateLimiter, secret } = deps
  const now = deps.now ?? (() => new Date())
  const generateCode = deps.generateCode ?? generateOtpCode

  return {
    /** Génère, stocke (haché) et envoie un code. Invalide les codes précédents du numéro. */
    async request(phone: string): Promise<void> {
      const requests = await rateLimiter.hit(
        redisKeys.otpRequests(phone),
        OTP_REQUEST_WINDOW_SECONDS,
      )
      if (requests > MAX_OTP_REQUESTS) {
        throw new AppError(
          429,
          'RATE_LIMIT_EXCEEDED',
          'Trop de demandes. Réessayez dans 10 minutes.',
        )
      }

      const code = generateCode()
      await store.invalidatePending(phone)
      await store.create({
        phone,
        codeHash: hashCode(secret, phone, code),
        expiresAt: new Date(now().getTime() + OTP_TTL_MS),
      })

      try {
        await sender.send(phone, code)
      } catch (cause) {
        throw Object.assign(
          new AppError(502, 'OTP_DELIVERY_FAILED', 'Impossible d’envoyer le code. Réessayez.'),
          { cause },
        )
      }
    },

    /**
     * Vérifie le code sans le consommer. Chaque essai raté est compté :
     * après MAX_OTP_ATTEMPTS, le code est mort même si on finit par donner le bon.
     */
    async check(phone: string, code: string): Promise<OtpRecord> {
      const record = await store.findActive(phone, now())
      if (!record || record.attempts >= MAX_OTP_ATTEMPTS) throw invalidOtp()

      if (!safeEqual(hashCode(secret, phone, code), record.codeHash)) {
        await store.incrementAttempts(record.id)
        throw invalidOtp()
      }

      return record
    },

    /** Consomme un code vérifié. Deux appels simultanés : un seul réussit. */
    async consume(record: OtpRecord): Promise<void> {
      if (!(await store.consume(record.id))) throw invalidOtp()
    },
  }
}

export type OtpService = ReturnType<typeof createOtpService>
