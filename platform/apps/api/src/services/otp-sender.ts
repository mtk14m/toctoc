import type { OtpSender } from './otp.js'

/**
 * Écrit le code dans les logs au lieu de l'envoyer : c'est l'envoi « de développement »,
 * utilisé tant qu'aucun fournisseur WhatsApp / SMS n'est branché.
 * Quiconque lit les logs peut se connecter : ne pas s'en servir avec de vrais clients.
 */
export class ConsoleOtpSender implements OtpSender {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(phone: string, code: string): Promise<void> {
    this.log('──────────────────────────────────────────')
    this.log(`[OTP] Pour : ${phone}`)
    this.log(`[OTP] Code : ${code}`)
    this.log('──────────────────────────────────────────')
  }
}
