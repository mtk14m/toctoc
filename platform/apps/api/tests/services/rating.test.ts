import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RATINGS_PER_IP, createRatingService } from '../../src/services/rating.js'
import {
  InMemoryGroupOrderStore,
  InMemoryRateLimiter,
  InMemoryRatingStore,
  InMemoryUserStore,
  RecordingPublisher,
} from '../helpers/fakes.js'

describe('RatingService — noter le restaurant après la livraison', () => {
  let users: InMemoryUserStore
  let groups: InMemoryGroupOrderStore
  let store: InMemoryRatingStore
  let publisher: RecordingPublisher
  let service: ReturnType<typeof createRatingService>
  let aicha: string
  let mamadou: string
  let itemOf: Record<'aicha' | 'mamadou', string>

  const rate = (orderItemId: string, phone: string, score: number, ip = '203.0.113.7') =>
    service.rate(orderItemId, { phone, score }, ip)

  const addItem = (
    userId: string,
    name: string,
    status: 'CONFIRMED' | 'CANCELLED' | 'PENDING_PAYMENT',
  ) => {
    const id = `item_${groups.orderItems.length + 1}`
    groups.orderItems.push({
      id,
      groupOrderId: 'group_1',
      userId,
      participantName: name,
      menuItemName: 'Riz gras',
      quantity: 1,
      status,
    })
    return id
  }

  beforeEach(async () => {
    users = new InMemoryUserStore()
    groups = new InMemoryGroupOrderStore(users)
    store = new InMemoryRatingStore(groups, users)
    publisher = new RecordingPublisher()
    service = createRatingService({
      store,
      realtime: publisher,
      rateLimiter: new InMemoryRateLimiter(),
      defaultCountryCode: '224',
    })

    aicha = (await users.create({ phone: '+224622000001', name: 'Aïcha' })).id
    mamadou = (await users.create({ phone: '+224622000002', name: 'Mamadou' })).id
    groups.partners.push({
      id: 'partner_1',
      name: 'Chez Aïssatou',
      type: 'CUISINE_MAISON',
      active: true,
    })
    groups.groupOrders.push({
      id: 'group_1',
      creatorId: aicha,
      partnerId: 'partner_1',
      shareToken: 'lien',
      deliveryAddress: 'Kaloum Center',
      orderCutoffTime: new Date('2026-09-21T10:20:00.000Z'),
      deliveryTime: new Date('2026-09-21T11:05:00.000Z'),
      paymentMode: 'SPLIT',
      status: 'DELIVERED',
    })
    itemOf = {
      aicha: addItem(aicha, 'Aïcha', 'CONFIRMED'),
      mamadou: addItem(mamadou, 'Mamadou', 'CONFIRMED'),
    }
  })

  it('enregistre la note du restaurant, avec la moyenne de la commande', async () => {
    const result = await rate(itemOf.aicha, '622 00 00 01', 5)

    expect(result).toEqual({ score: 5, summary: { average: 5, count: 1 } })
    expect(store.ratings).toEqual([{ orderItemId: itemOf.aicha, partnerId: 'partner_1', score: 5 }])
  })

  it('annonce la moyenne mise à jour à tous ceux qui sont encore sur la page', async () => {
    await rate(itemOf.aicha, '622000001', 5)
    await rate(itemOf.mamadou, '622000002', 4)

    expect(publisher.published.at(-1)).toEqual({
      room: 'groupOrder:group_1',
      event: 'groupOrder:rating_added',
      payload: { average: 4.5, count: 2 },
    })
  })

  it('arrondit la moyenne à une décimale', async () => {
    const third = addItem(aicha, 'Aïcha bis', 'CONFIRMED')
    await rate(itemOf.aicha, '622000001', 5)
    await rate(itemOf.mamadou, '622000002', 4)
    // une troisième part du même téléphone que la première : chacune sa propre note
    await rate(third, '622000001', 4)

    expect(publisher.published.at(-1)!.payload).toEqual({ average: 4.3, count: 3 })
  })

  it('ne note qu’une fois par part (409 ALREADY_RATED), sans annoncer une deuxième fois', async () => {
    await rate(itemOf.aicha, '622000001', 5)
    publisher.published.length = 0

    await expect(rate(itemOf.aicha, '622000001', 1)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_RATED',
    })
    expect(store.ratings).toHaveLength(1)
    expect(store.ratings[0]!.score).toBe(5)
    expect(publisher.published).toEqual([])
  })

  describe('qui peut noter', () => {
    it('seulement celui dont c’est la part : le numéro doit correspondre (404, sans révéler que la part existe)', async () => {
      await expect(rate(itemOf.aicha, '622000002', 5)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ORDER_ITEM_NOT_FOUND',
      })
      await expect(rate('inconnue', '622000001', 5)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ORDER_ITEM_NOT_FOUND',
      })
      expect(store.ratings).toEqual([])
    })

    it('reconnaît le numéro quelle que soit la façon de l’écrire', async () => {
      for (const [phone, item] of [
        ['+224 622 00 00 01', itemOf.aicha],
        ['00224622000002', itemOf.mamadou],
      ] as const) {
        await expect(rate(item, phone, 4)).resolves.toBeDefined()
      }
    })

    it('refuse un numéro invalide (400 INVALID_PHONE)', async () => {
      await expect(rate(itemOf.aicha, '12', 5)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PHONE',
      })
    })

    it.each(['PENDING_PAYMENT', 'CANCELLED'] as const)(
      'refuse une part %s : on ne note que ce qu’on a payé et reçu (409 NOT_RATEABLE)',
      async (status) => {
        groups.orderItems.find((i) => i.id === itemOf.aicha)!.status = status

        await expect(rate(itemOf.aicha, '622000001', 5)).rejects.toMatchObject({
          statusCode: 409,
          code: 'NOT_RATEABLE',
        })
      },
    )

    it.each(['OPEN', 'CLOSED', 'IN_DELIVERY', 'CANCELLED'] as const)(
      'refuse tant que la commande n’est pas livrée : %s (409 NOT_DELIVERED_YET)',
      async (status) => {
        groups.groupOrders[0]!.status = status

        await expect(rate(itemOf.aicha, '622000001', 5)).rejects.toMatchObject({
          statusCode: 409,
          code: 'NOT_DELIVERED_YET',
        })
      },
    )
  })

  it('limite les notes par IP (429 RATE_LIMIT_EXCEEDED)', async () => {
    for (let i = 0; i < MAX_RATINGS_PER_IP; i++) {
      await rate(itemOf.aicha, '622000001', 5).catch(() => undefined)
    }

    await expect(rate(itemOf.mamadou, '622000002', 4)).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMIT_EXCEEDED',
    })
  })
})
