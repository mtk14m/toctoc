import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import {
  CLOSING_INTERVAL_MS,
  CLOSING_QUEUE,
  scheduleClosingWorker,
} from '../../src/jobs/closing-worker.js'
import type { ClosingService } from '../../src/services/closing.js'

// BullMQ simulé : ces tests vérifient NOTRE usage de son API (bonne file, un passage par minute,
// fermeture dans le bon ordre), pas le comportement de BullMQ, qui demande un vrai Redis.
const created = vi.hoisted(() => ({
  queues: [] as Array<{
    name: string
    upsertJobScheduler: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }>,
  workers: [] as Array<{
    name: string
    processor: () => Promise<unknown>
    options: { concurrency?: number }
    handlers: Record<string, (...args: unknown[]) => void>
    close: ReturnType<typeof vi.fn>
  }>,
  calls: [] as string[],
}))

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = vi.fn(async () => undefined)
    close = vi.fn(async () => {
      created.calls.push('queue.close')
    })
    constructor(public name: string) {
      created.queues.push(this)
    }
  },
  Worker: class {
    handlers: Record<string, (...args: unknown[]) => void> = {}
    close = vi.fn(async () => {
      created.calls.push('worker.close')
    })
    constructor(
      public name: string,
      public processor: () => Promise<unknown>,
      public options: { concurrency?: number },
    ) {
      created.workers.push(this)
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler
      return this
    }
  },
}))

describe('scheduleClosingWorker', () => {
  const summary = { closed: 1, cancelled: 0, notified: 1 }
  let run: ReturnType<typeof vi.fn>
  let log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }

  const schedule = () =>
    scheduleClosingWorker({
      connection: { host: 'localhost' },
      closing: { run } as unknown as ClosingService,
      log: log as unknown as FastifyBaseLogger,
    })

  beforeEach(() => {
    created.queues.length = 0
    created.workers.length = 0
    created.calls.length = 0
    run = vi.fn(async () => summary)
    log = { info: vi.fn(), error: vi.fn() }
  })

  it('crée la file et son worker sur le même nom, un passage à la fois', async () => {
    await schedule()

    expect(created.queues.map((q) => q.name)).toEqual([CLOSING_QUEUE])
    expect(created.workers.map((w) => w.name)).toEqual([CLOSING_QUEUE])
    expect(created.workers[0]!.options.concurrency).toBe(1)
  })

  it('planifie un passage par minute, en remplaçant le planning existant au redémarrage', async () => {
    await schedule()

    expect(created.queues[0]!.upsertJobScheduler).toHaveBeenCalledExactlyOnceWith(
      'closing-tick',
      { every: CLOSING_INTERVAL_MS },
      expect.objectContaining({ name: 'close-due' }),
    )
    expect(CLOSING_INTERVAL_MS).toBe(60_000)
  })

  it('ne garde pas les passages réussis dans Redis (un par minute, ça s’accumulerait)', async () => {
    await schedule()

    const [, , template] = created.queues[0]!.upsertJobScheduler.mock.calls[0]!
    expect(template.opts.removeOnComplete).toBe(true)
  })

  it('exécute la clôture complète à chaque passage', async () => {
    await schedule()

    const result = await created.workers[0]!.processor()

    expect(run).toHaveBeenCalledOnce()
    expect(result).toEqual(summary)
  })

  it('journalise un passage qui a fait quelque chose, pas un passage vide', async () => {
    await schedule()
    const { completed } = created.workers[0]!.handlers

    completed!({}, { closed: 0, cancelled: 0, notified: 0 })
    expect(log.info).not.toHaveBeenCalled()

    completed!({}, summary)
    expect(log.info).toHaveBeenCalledExactlyOnceWith(summary, expect.any(String))
  })

  it('journalise un passage en échec et une erreur du worker', async () => {
    await schedule()
    const { failed, error } = created.workers[0]!.handlers
    const boom = new Error('Redis coupé')

    failed!({}, boom)
    error!(boom)

    expect(log.error).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith({ err: boom }, expect.any(String))
  })

  it('à l’arrêt, laisse finir le passage en cours (worker) avant de fermer la file', async () => {
    const handle = await schedule()

    await handle.close()

    expect(created.calls).toEqual(['worker.close', 'queue.close'])
  })
})
