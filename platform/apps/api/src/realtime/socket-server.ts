import type { FastifyInstance } from 'fastify'
import { Server, type ServerOptions } from 'socket.io'
import { z } from 'zod'
import {
  groupOrderRoom,
  orderItemRoom,
  type ClientToServerEvents,
  type RealtimePublisher,
  type RoomAck,
  type ServerToClientEvents,
} from './events.js'
import { SocketIoPublisher } from './socket-io-publisher.js'

/** Une connexion suit un lien et quelques commandes, pas des centaines de rooms. */
export const MAX_ROOMS_PER_SOCKET = 5

const joinSchema = z.object({ shareToken: z.string().min(1).max(64) })
const watchSchema = z.object({ orderItemId: z.string().min(1).max(64) })

export interface SocketServerOptions {
  corsOrigins: string[]
  /** Adaptateur Redis en production, pour diffuser entre plusieurs instances de l'API. */
  adapter?: ServerOptions['adapter'] | undefined
  /** L'id interne du lien : les rooms portent l'id, jamais le jeton public. */
  findGroupOrderId: (shareToken: string) => Promise<string | null>
}

/**
 * Attache Socket.io au serveur HTTP de l'application et renvoie le publisher que les services
 * utilisent pour diffuser. Aucune authentification : comme la page du lien, le temps réel est
 * public (docs/06 — pas de compte pour rejoindre). Les rooms de commande ne diffusent que des
 * statuts, pour la personne qui connaît l'id de sa commande.
 */
export function attachSocketServer(
  app: FastifyInstance,
  options: SocketServerOptions,
): RealtimePublisher {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: options.corsOrigins, credentials: true },
    ...(options.adapter && { adapter: options.adapter }),
  })

  io.on('connection', (socket) => {
    // Chaque socket est déjà dans sa propre room (son id) : elle ne compte pas.
    const canJoin = (room: string) =>
      socket.rooms.has(room) || socket.rooms.size - 1 < MAX_ROOMS_PER_SOCKET

    // Un client peut oublier l'accusé de réception : ne jamais planter sur une entrée non fiable.
    const respond = (ack: unknown, result: RoomAck) => {
      if (typeof ack === 'function') ack(result)
    }

    socket.on('groupOrder:join', async (payload, ack) => {
      try {
        const parsed = joinSchema.safeParse(payload)
        if (!parsed.success) return respond(ack, { ok: false, code: 'BAD_REQUEST' })

        const groupOrderId = await options.findGroupOrderId(parsed.data.shareToken)
        if (!groupOrderId) return respond(ack, { ok: false, code: 'GROUP_ORDER_NOT_FOUND' })

        const room = groupOrderRoom(groupOrderId)
        if (!canJoin(room)) return respond(ack, { ok: false, code: 'TOO_MANY_ROOMS' })

        await socket.join(room)
        respond(ack, { ok: true })
      } catch (error) {
        app.log.error({ err: error }, 'temps réel : impossible de rejoindre un lien')
        respond(ack, { ok: false, code: 'INTERNAL_ERROR' })
      }
    })

    // Pas de vérification en base : l'id d'une commande inconnue ouvre une room qui ne reçoit
    // jamais rien, et la réponse ne permet pas de deviner quelles commandes existent.
    socket.on('orderItem:watch', async (payload, ack) => {
      try {
        const parsed = watchSchema.safeParse(payload)
        if (!parsed.success) return respond(ack, { ok: false, code: 'BAD_REQUEST' })

        const room = orderItemRoom(parsed.data.orderItemId)
        if (!canJoin(room)) return respond(ack, { ok: false, code: 'TOO_MANY_ROOMS' })

        await socket.join(room)
        respond(ack, { ok: true })
      } catch (error) {
        app.log.error({ err: error }, 'temps réel : impossible de suivre une commande')
        respond(ack, { ok: false, code: 'INTERNAL_ERROR' })
      }
    })
  })

  // Sans ça, un navigateur resté connecté empêcherait l'arrêt propre du serveur.
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true)
  })
  app.addHook('onClose', async () => {
    await io.close()
  })

  return new SocketIoPublisher(io, (err) =>
    app.log.error({ err }, 'temps réel : diffusion impossible'),
  )
}
