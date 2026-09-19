/** Canal d'envoi du récap au partenaire : console aujourd'hui, WhatsApp / SMS demain (docs/09 §2). */
export interface PartnerNotifier {
  sendRecap(partner: { name: string; phone: string }, message: string): Promise<void>
}

/**
 * Écrit le récap dans les logs au lieu de l'envoyer : c'est l'envoi « de développement ». En
 * pilote, l'équipe TocToc lit le récap dans les logs et le transmet elle-même au partenaire ;
 * ça ne passe pas à l'échelle, et rien ne prévient le partenaire si personne ne regarde.
 */
export class ConsolePartnerNotifier implements PartnerNotifier {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async sendRecap(partner: { name: string; phone: string }, message: string): Promise<void> {
    this.log('──────────────────────────────────────────')
    this.log(`[RÉCAP] Pour : ${partner.name} (${partner.phone})`)
    for (const line of message.split('\n')) this.log(`[RÉCAP] ${line}`)
    this.log('──────────────────────────────────────────')
  }
}
