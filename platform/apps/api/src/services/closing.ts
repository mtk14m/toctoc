import { groupOrderRoom, orderItemRoom, type RealtimePublisher } from '../realtime/events.js'
import type { PartnerNotifier } from './partner-notifier.js'
import { PAYMENT_GRACE_MS } from './payment.js'

/** Combien de liens un passage traite : s'il y en a plus, le passage suivant continue. */
export const CLOSING_BATCH_SIZE = 50

/** Ce qu'il faut au partenaire pour préparer : jamais de téléphone ni de nom de participant. */
export interface RecapCandidate {
  groupOrderId: string
  partner: { name: string; phone: string }
  deliveryAddress: string
  deliveryTime: Date
  /** Une ligne par commande payée : le regroupement par plat est fait par `formatRecap`. */
  items: Array<{ dish: string; quantity: number }>
}

export type CloseResult =
  { status: 'skipped' } | { status: 'closed' | 'cancelled'; cancelledOrderItemIds: string[] }

/** Persistance de la clôture. Prisma en production, en mémoire dans les tests. */
export interface ClosingStore {
  /** Liens SPLIT ouverts dont l'heure limite est antérieure à `cutoffBefore`, du plus ancien au plus récent. */
  findDueGroupOrderIds(cutoffBefore: Date, limit: number): Promise<string[]>
  /**
   * Ferme un lien de façon atomique, sous le même verrou que `join` et les paiements : annule les
   * commandes encore en attente de paiement, puis passe le lien à CLOSED — ou à CANCELLED quand
   * personne n'a payé. Ne touche pas aux paiements en attente (voir le service). Renvoie
   * `skipped` si le lien n'est plus ouvert (un autre passage l'a déjà fermé).
   */
  close(groupOrderId: string): Promise<CloseResult>
  /** Liens CLOSED dont le récap n'a pas encore été transmis au partenaire. */
  findPendingRecaps(limit: number): Promise<RecapCandidate[]>
  markPartnerNotified(groupOrderId: string, at: Date): Promise<void>
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Le message envoyé au partenaire (docs/09 §2) : ce qu'il faut préparer, et quand le livreur passe.
 * Dates et heures en UTC : la Guinée n'a pas d'heure d'été.
 */
export function formatRecap(recap: RecapCandidate): string {
  const byDish = new Map<string, number>()
  for (const { dish, quantity } of recap.items) {
    byDish.set(dish, (byDish.get(dish) ?? 0) + quantity)
  }
  const lines = [...byDish].sort(
    ([dishA, quantityA], [dishB, quantityB]) =>
      quantityB - quantityA || dishA.localeCompare(dishB, 'fr'),
  )
  const total = lines.reduce((sum, [, quantity]) => sum + quantity, 0)

  const { deliveryTime: at } = recap
  const day = `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}`
  const time = `${pad(at.getUTCHours())}h${pad(at.getUTCMinutes())}`

  return [
    `Bonjour ${recap.partner.name}, voici la commande TocToc à préparer :`,
    ...lines.map(([dish, quantity]) => `${quantity}× ${dish}`),
    `Total : ${total} ${total > 1 ? 'plats' : 'plat'}`,
    `Livraison le ${day} à ${time} — ${recap.deliveryAddress}`,
  ].join('\n')
}

export interface ClosingServiceDeps {
  store: ClosingStore
  notifier: PartnerNotifier
  realtime: RealtimePublisher
  /** Une erreur sur un lien est journalisée ici : elle ne doit pas empêcher de traiter les autres. */
  onError?: (error: unknown) => void
  now?: () => Date
}

export function createClosingService(deps: ClosingServiceDeps) {
  const { store, notifier, realtime } = deps
  const now = deps.now ?? (() => new Date())
  const onError = deps.onError ?? (() => undefined)

  /** À tous ceux qui ont ouvert le lien, et en privé à ceux dont la commande vient d'être annulée. */
  function announce(groupOrderId: string, result: Exclude<CloseResult, { status: 'skipped' }>) {
    realtime.publish(groupOrderRoom(groupOrderId), 'groupOrder:closed', {
      status: result.status === 'closed' ? 'CLOSED' : 'CANCELLED',
    })
    for (const orderItemId of result.cancelledOrderItemIds) {
      realtime.publish(orderItemRoom(orderItemId), 'orderItem:updated', {
        orderItemId,
        status: 'CANCELLED',
        reason: 'LINK_CLOSED',
      })
    }
  }

  /**
   * Ferme les liens dont l'heure limite plus la fenêtre de grâce est passée (docs/09 §1).
   * Idempotent : un lien déjà fermé est ignoré, donc deux passages (ou deux instances) qui se
   * chevauchent ne se gênent pas. Les liens HOST_PAYS ne sont pas traités ici : leurs commandes
   * « en attente » le sont par conception, et la charge unique du créateur est un autre chantier.
   *
   * Les paiements en attente ne sont pas modifiés : si l'opérateur confirme un débit après coup,
   * le service de paiement doit encore le reconnaître (« late ») pour qu'il soit remboursé.
   */
  async function closeDue(): Promise<{ closed: number; cancelled: number }> {
    const dueBefore = new Date(now().getTime() - PAYMENT_GRACE_MS)
    let closed = 0
    let cancelled = 0

    for (const groupOrderId of await store.findDueGroupOrderIds(dueBefore, CLOSING_BATCH_SIZE)) {
      try {
        const result = await store.close(groupOrderId)
        if (result.status === 'skipped') continue

        if (result.status === 'closed') closed += 1
        else cancelled += 1
        announce(groupOrderId, result)
      } catch (error) {
        onError(error)
      }
    }
    return { closed, cancelled }
  }

  /**
   * Transmet le récap aux partenaires des liens fermés qui ne l'ont pas encore reçu. Au moins
   * une fois : un envoi qui échoue n'est pas marqué, donc réessayé au passage suivant, quitte à
   * envoyer deux fois si le plantage survient entre l'envoi et le marquage — mieux vaut un
   * doublon qu'un partenaire qui ne cuisine pas alors que les clients ont payé.
   */
  async function notifyPartners(): Promise<number> {
    let notified = 0

    for (const recap of await store.findPendingRecaps(CLOSING_BATCH_SIZE)) {
      try {
        await notifier.sendRecap(recap.partner, formatRecap(recap))
        await store.markPartnerNotified(recap.groupOrderId, now())
        notified += 1
      } catch (error) {
        onError(error)
      }
    }
    return notified
  }

  /** Un passage complet : fermer, puis transmettre (le récap d'un lien tout juste fermé part tout de suite). */
  async function run(): Promise<{ closed: number; cancelled: number; notified: number }> {
    const closing = await closeDue()
    return { ...closing, notified: await notifyPartners() }
  }

  return { closeDue, notifyPartners, run }
}

export type ClosingService = ReturnType<typeof createClosingService>
