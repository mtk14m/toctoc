import type { RealtimePublisher, ServerToClientEvents } from './events.js'

/** Le strict nécessaire de `io` : diffuser dans une room. */
export interface RoomBroadcaster {
  to(room: string): { emit(event: string, ...args: unknown[]): unknown }
}

export class SocketIoPublisher implements RealtimePublisher {
  constructor(
    private readonly io: RoomBroadcaster,
    private readonly onError: (error: unknown) => void,
  ) {}

  publish<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    try {
      this.io.to(room).emit(event, ...args)
    } catch (error) {
      // Le paiement est déjà encaissé : on journalise, on ne fait pas échouer le webhook.
      this.onError(error)
    }
  }
}
