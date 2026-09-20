import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { ApiClient } from '../../api/client'
import { restaurantFixture } from '../../test/fixtures'
import { LandingPage } from './LandingPage'

const renderPage = () =>
  render(
    <ApiProvider
      client={
        {
          get: vi.fn().mockResolvedValue({ restaurants: [restaurantFixture()] }),
        } as unknown as ApiClient
      }
    >
      <LandingPage />
    </ApiProvider>,
  )

describe('LandingPage — la page d’accueil', () => {
  it('pose la promesse dès le titre : le déjeuner du bureau, en un lien', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Le déjeuner du bureau, en un lien.',
    )
  })

  it('propose de choisir un restaurant, qui mène à l’annuaire de la page', () => {
    renderPage()

    const cta = screen.getByRole('link', { name: 'Choisir un restaurant' })

    expect(cta).toHaveAttribute('href', '#restaurants')
    expect(document.querySelector('#restaurants')).toBeInTheDocument()
  })

  it('a une navigation et un pied de page repérables', () => {
    renderPage()

    const nav = screen.getByRole('navigation', { name: 'Principale' })
    expect(within(nav).getByRole('link', { name: 'Comment ça marche' })).toHaveAttribute(
      'href',
      '#comment-ca-marche',
    )
    expect(within(nav).getByRole('link', { name: 'Restaurants' })).toHaveAttribute(
      'href',
      '#restaurants',
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('explique le parcours en trois étapes, avec les 20 minutes', () => {
    renderPage()

    const section = screen.getByRole('region', { name: 'Comment ça marche' })
    const steps = within(section).getAllByRole('listitem')

    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveTextContent('Lancez')
    expect(steps[1]).toHaveTextContent('20 minutes')
    expect(steps[2]).toHaveTextContent('Recevez')
  })

  it('explique que la livraison coûte moins cher à plusieurs', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { name: /Plus vous êtes nombreux, moins la livraison coûte/ }),
    ).toBeInTheDocument()
  })

  it('charge les restaurants du jour', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Chez Aïssatou' })).toBeInTheDocument()
  })
})
