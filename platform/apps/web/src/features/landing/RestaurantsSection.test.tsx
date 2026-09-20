import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError, type ApiClient } from '../../api/client'
import { restaurantFixture } from '../../test/fixtures'
import { RestaurantsSection } from './RestaurantsSection'

const renderWith = (get: ReturnType<typeof vi.fn>) =>
  render(
    <ApiProvider client={{ get } as unknown as ApiClient}>
      <RestaurantsSection />
    </ApiProvider>,
  )

const directory = (...restaurants: ReturnType<typeof restaurantFixture>[]) => ({ restaurants })

describe('RestaurantsSection — l’annuaire sur la page d’accueil', () => {
  it('annonce le chargement sans vider la page', () => {
    renderWith(vi.fn(() => new Promise(() => undefined)))

    expect(screen.getByRole('heading', { name: 'Les restaurants du jour' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Chargement des restaurants…')
  })

  it('affiche une fiche par restaurant, dans l’ordre de l’API', async () => {
    renderWith(
      vi
        .fn()
        .mockResolvedValue(
          directory(
            restaurantFixture({ id: 'a', name: 'Chez Aïssatou' }),
            restaurantFixture({ id: 'b', name: 'Le Baobab' }),
          ),
        ),
    )

    const cards = await screen.findAllByRole('article')

    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Chez Aïssatou')
    expect(cards[1]).toHaveTextContent('Le Baobab')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('dit franchement qu’il n’y a encore personne, plutôt que de laisser un blanc', async () => {
    renderWith(vi.fn().mockResolvedValue(directory()))

    expect(await screen.findByText(/Aucun restaurant n’est encore ouvert/)).toBeInTheDocument()
  })

  it('explique l’échec et propose de réessayer, sans recharger la page', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Pas de connexion. Réessayez.'))
      .mockResolvedValueOnce(directory(restaurantFixture()))
    renderWith(get)

    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion. Réessayez.')

    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByRole('article')).toHaveTextContent('Chez Aïssatou')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('donne un message générique pour une erreur qu’on ne connaît pas', async () => {
    renderWith(vi.fn().mockRejectedValue(new Error('boom')))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de charger les restaurants pour le moment.',
    )
  })

  it('annule la requête quand on quitte la page', () => {
    const get = vi.fn(
      (_path: string, _options?: { signal: AbortSignal }) => new Promise(() => undefined),
    )
    const { unmount } = renderWith(get)
    const { signal } = get.mock.calls[0]![1]!

    expect(signal.aborted).toBe(false)
    unmount()

    expect(signal.aborted).toBe(true)
  })
})
