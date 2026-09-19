import { describe, expect, it, vi } from 'vitest'
import type { Server } from 'socket.io'
import { groupOrderRoom, orderItemRoom } from '../../src/realtime/events.js'
import { SocketIoPublisher } from '../../src/realtime/socket-io-publisher.js'

const payload = {
  participant: { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
  nextDeliveryFee: 6000,
}

describe('rooms', () => {
  it('sont nommées au même endroit, une par lien et une par commande', () => {
    expect(groupOrderRoom('g1')).toBe('groupOrder:g1')
    expect(orderItemRoom('i1')).toBe('orderItem:i1')
  })
})

describe('SocketIoPublisher', () => {
  it('émet l’évènement dans la room demandée, et seulement celle-là', () => {
    const emit = vi.fn()
    const to = vi.fn(() => ({ emit }))
    const publisher = new SocketIoPublisher({ to } as unknown as Server, vi.fn())

    publisher.publish('groupOrder:g1', 'groupOrder:item_added', payload)

    expect(to).toHaveBeenCalledExactlyOnceWith('groupOrder:g1')
    expect(emit).toHaveBeenCalledExactlyOnceWith('groupOrder:item_added', payload)
  })

  it('ne lève jamais : une panne du temps réel ne doit pas faire échouer un paiement', () => {
    const boom = new Error('adaptateur Redis indisponible')
    const onError = vi.fn()
    const io = {
      to: () => {
        throw boom
      },
    }
    const publisher = new SocketIoPublisher(io as unknown as Server, onError)

    expect(() => publisher.publish('groupOrder:g1', 'groupOrder:item_added', payload)).not.toThrow()
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom)
  })
})
