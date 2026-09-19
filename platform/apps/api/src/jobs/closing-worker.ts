import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type { FastifyBaseLogger } from 'fastify'
import type { ClosingService } from '../services/closing.js'

export const CLOSING_QUEUE = 'group-order-closing'
/** L'heure limite est à la minute près : un passage par minute suffit, et coûte une requête vide. */
export const CLOSING_INTERVAL_MS = 60_000

export interface ClosingWorkerHandle {
  close(): Promise<void>
}

/**
 * Une paire Queue + Worker, comme les autres jobs planifiés de CityMoov (docs/07) : BullMQ garantit
 * qu'un seul exemplaire du passage tourne à la fois, même avec plusieurs instances de l'API. Toute
 * la logique est dans `ClosingService` (testée sans Redis) : ce fichier ne fait que la planifier.
 */
export async function scheduleClosingWorker(options: {
  connection: ConnectionOptions
  closing: ClosingService
  log: FastifyBaseLogger
}): Promise<ClosingWorkerHandle> {
  const { connection, closing, log } = options

  const queue = new Queue(CLOSING_QUEUE, { connection })
  const worker = new Worker(CLOSING_QUEUE, () => closing.run(), { connection, concurrency: 1 })

  worker.on('completed', (_job, summary) => {
    const { closed, cancelled, notified } = summary
    if (closed + cancelled + notified > 0) log.info(summary, 'clôture : passage terminé')
  })
  worker.on('failed', (_job, err) => log.error({ err }, 'clôture : passage en échec'))
  worker.on('error', (err) => log.error({ err }, 'clôture : erreur du worker'))

  // `upsert` : au redémarrage, on remplace le planning au lieu d'en empiler un second.
  await queue.upsertJobScheduler(
    'closing-tick',
    { every: CLOSING_INTERVAL_MS },
    { name: 'close-due', opts: { removeOnComplete: true, removeOnFail: { count: 50 } } },
  )

  return {
    async close() {
      await worker.close()
      await queue.close()
    },
  }
}
