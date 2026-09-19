import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as connect, type Socket } from 'socket.io-client'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { MAX_ROOMS_PER_SOCKET } from '../../src/realtime/socket-server.js'
import { signPayload } from '../../src/services/payment-gateway.js'
import { TEST_WEBHOOK_SECRET, createTestDeps } from '../helpers/fakes.js'
import { seedOpenGroupOrder } from '../helpers/fixtures.js'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ce que ces tests exercent pour de vrai : un serveur qui écoute et de vrais clients Socket.io. */
describe('temps réel (Socket.io)', () => {
  let app: FastifyInstance
  let deps: ReturnType<typeof createTestDeps>
  let port: number
  let clients: Socket[]

  beforeEach(async () => {
    clients = []
    deps = createTestDeps()
    app = await buildApp(loadConfig({ NODE_ENV: 'test' }), deps)
    await app.listen({ port: 0, host: '127.0.0.1' })
    port = (app.server.address() as AddressInfo).port
  })

  afterEach(async () => {
    for (const client of clients) client.close()
    await app.close()
  })

  async function connectClient(): Promise<Socket> {
    const client = connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    })
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('connect_error', reject)
    })
    return client
  }

  /** Un navigateur qui a ouvert le lien : connecté et abonné à sa room. */
  async function openLink(shareToken: string): Promise<Socket> {
    const client = await connectClient()
    expect(await client.emitWithAck('groupOrder:join', { shareToken })).toEqual({ ok: true })
    return client
  }

  const nextEvent = <T = unknown>(client: Socket, event: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`aucun « ${event} » reçu en 2 s`)), 2000)
      client.once(event, (payload: T) => {
        clearTimeout(timer)
        resolve(payload)
      })
    })

  const collect = (client: Socket, event: string) => {
    const received: unknown[] = []
    client.on(event, (payload) => received.push(payload))
    return received
  }

  const join = async (
    link: { shareToken: string; menuItemId: string },
    phone = '622 00 00 01',
    name = 'Aïcha',
  ) => {
    const res = await app.inject({
      method: 'POST',
      url: `/group-orders/${link.shareToken}/items`,
      payload: { menuItemId: link.menuItemId, quantity: 1, phone, name },
    })
    expect(res.statusCode).toBe(201)
    return res.json().data.orderItem as { id: string }
  }

  const sendWebhook = (status: 'CONFIRMED' | 'FAILED', paymentIndex = 0, amount = 31000) => {
    const rawBody = JSON.stringify({
      reference: deps.paymentStore.payments[paymentIndex]!.id,
      providerTransactionId: 'tx_operateur_1',
      amount,
      status,
    })
    return app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      payload: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-toctoc-signature': signPayload(TEST_WEBHOOK_SECRET, rawBody),
      },
    })
  }

  describe('rejoindre la room d’un lien', () => {
    it('accepte un client qui donne le jeton du lien (le lien public suffit, pas de compte)', async () => {
      await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const client = await connectClient()

      const ack = await client.emitWithAck('groupOrder:join', { shareToken: 'lien-a' })

      expect(ack).toEqual({ ok: true })
    })

    it('refuse un jeton inconnu', async () => {
      const client = await connectClient()

      const ack = await client.emitWithAck('groupOrder:join', { shareToken: 'inconnu' })

      expect(ack).toEqual({ ok: false, code: 'GROUP_ORDER_NOT_FOUND' })
    })

    it.each([
      ['sans jeton', {}],
      ['avec un jeton qui n’est pas du texte', { shareToken: 42 }],
      ['avec un jeton vide', { shareToken: '' }],
      ['sans rien', undefined],
    ])('refuse une demande %s', async (_label, payload) => {
      const client = await connectClient()

      const ack = await client.emitWithAck('groupOrder:join', payload)

      expect(ack).toEqual({ ok: false, code: 'BAD_REQUEST' })
    })

    it('limite le nombre de rooms par connexion', async () => {
      const client = await connectClient()
      for (let i = 0; i < MAX_ROOMS_PER_SOCKET; i++) {
        expect(await client.emitWithAck('orderItem:watch', { orderItemId: `item_${i}` })).toEqual({
          ok: true,
        })
      }

      const ack = await client.emitWithAck('orderItem:watch', { orderItemId: 'un_de_trop' })

      expect(ack).toEqual({ ok: false, code: 'TOO_MANY_ROOMS' })
    })
  })

  describe('la liste qui se remplit en direct (le waouh n°1)', () => {
    it('un paiement confirmé apparaît chez tous ceux qui ont ouvert le lien, avec le prochain tarif', async () => {
      const link = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const first = await openLink('lien-a')
      const second = await openLink('lien-a')
      await join(link)
      const seenByFirst = nextEvent(first, 'groupOrder:item_added')
      const seenBySecond = nextEvent(second, 'groupOrder:item_added')

      await sendWebhook('CONFIRMED')

      const expected = {
        participant: { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: false },
        nextDeliveryFee: 6000,
      }
      expect(await seenByFirst).toEqual(expected)
      expect(await seenBySecond).toEqual(expected)
    })

    it('rien n’apparaît tant que la personne n’a pas payé (mode SPLIT)', async () => {
      const link = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const watcher = await openLink('lien-a')
      const received = collect(watcher, 'groupOrder:item_added')

      await join(link)
      await pause(150)

      expect(received).toEqual([])
    })

    it('ne diffuse qu’aux navigateurs de ce lien, jamais à ceux d’un autre lien', async () => {
      const linkA = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      await seedOpenGroupOrder(deps, { shareToken: 'lien-b' })
      const inA = await openLink('lien-a')
      const inB = await openLink('lien-b')
      const receivedByB = collect(inB, 'groupOrder:item_added')
      const seenByA = nextEvent(inA, 'groupOrder:item_added')
      await join(linkA)

      await sendWebhook('CONFIRMED')

      await seenByA
      await pause(150)
      expect(receivedByB).toEqual([])
    })

    it('en HOST_PAYS, la personne apparaît tout de suite, marquée en attente', async () => {
      const link = await seedOpenGroupOrder(deps, {
        shareToken: 'lien-a',
        paymentMode: 'HOST_PAYS',
      })
      const watcher = await openLink('lien-a')
      const seen = nextEvent(watcher, 'groupOrder:item_pending')

      await join(link)

      expect(await seen).toEqual({
        participant: { name: 'Aïcha', dish: 'Riz gras', quantity: 1, pending: true },
        nextDeliveryFee: 6000,
      })
    })
  })

  describe('le message privé de la personne qui commande', () => {
    it('elle apprend que son paiement est confirmé', async () => {
      const link = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const item = await join(link)
      const mine = await connectClient()
      await mine.emitWithAck('orderItem:watch', { orderItemId: item.id })
      const update = nextEvent(mine, 'orderItem:updated')

      await sendWebhook('CONFIRMED')

      expect(await update).toEqual({
        orderItemId: item.id,
        status: 'CONFIRMED',
        reason: 'PAYMENT_CONFIRMED',
      })
    })

    it('elle apprend que son paiement a échoué, et le groupe n’en sait rien', async () => {
      const link = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const item = await join(link)
      const mine = await connectClient()
      await mine.emitWithAck('orderItem:watch', { orderItemId: item.id })
      const group = await openLink('lien-a')
      const groupEvents = [
        ...collect(group, 'groupOrder:item_added'),
        ...collect(group, 'orderItem:updated'),
      ]
      const update = nextEvent(mine, 'orderItem:updated')

      await sendWebhook('FAILED')

      expect(await update).toEqual({
        orderItemId: item.id,
        status: 'CANCELLED',
        reason: 'PAYMENT_FAILED',
      })
      await pause(150)
      expect(groupEvents).toEqual([])
    })

    it('les autres participants du lien ne reçoivent pas son message', async () => {
      const link = await seedOpenGroupOrder(deps, { shareToken: 'lien-a' })
      const item = await join(link)
      const mine = await connectClient()
      await mine.emitWithAck('orderItem:watch', { orderItemId: item.id })
      const somebodyElse = await openLink('lien-a')
      const received = collect(somebodyElse, 'orderItem:updated')
      const update = nextEvent(mine, 'orderItem:updated')

      await sendWebhook('CONFIRMED')

      await update
      await pause(150)
      expect(received).toEqual([])
    })
  })
})
