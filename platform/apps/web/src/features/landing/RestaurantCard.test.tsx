import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatGnf } from '../../lib/money'
import { restaurantFixture } from '../../test/fixtures'
import { RestaurantCard } from './RestaurantCard'

const card = (overrides = {}) =>
  render(<RestaurantCard restaurant={restaurantFixture(overrides)} />)

describe('RestaurantCard — une fiche de l’annuaire', () => {
  it('présente le restaurant : nom, ville, spécialités et heures de service', () => {
    card()

    expect(screen.getByRole('heading', { name: 'Chez Aïssatou' })).toBeInTheDocument()
    expect(screen.getByText('Conakry')).toBeInTheDocument()
    expect(screen.getByText('Guinéen')).toBeInTheDocument()
    expect(screen.getByText('Riz')).toBeInTheDocument()
    expect(screen.getByText('11h – 22h30')).toBeInTheDocument()
  })

  it('montre un aperçu du menu du jour avec les prix', () => {
    card()

    const menu = screen.getByRole('list', { name: 'Menu du jour' })
    const dishes = within(menu).getAllByRole('listitem')
    expect(dishes).toHaveLength(3)
    expect(dishes[0]).toHaveTextContent('Riz gras')
    // Le normaliseur par défaut remplacerait les espaces insécables : on compare le texte exact.
    const exact = { normalizer: (text: string) => text }
    expect(within(dishes[0]!).getByText(formatGnf(25000), exact)).toBeInTheDocument()
    expect(screen.getByText('+ 1 autre plat')).toBeInTheDocument()
  })

  it('accorde « autres plats » au pluriel', () => {
    card({ todaysMenu: { count: 6, preview: restaurantFixture().todaysMenu.preview } })

    expect(screen.getByText('+ 3 autres plats')).toBeInTheDocument()
  })

  it('n’ajoute rien quand tout le menu est déjà visible', () => {
    card({ todaysMenu: { count: 3, preview: restaurantFixture().todaysMenu.preview } })

    expect(screen.queryByText(/autre/)).not.toBeInTheDocument()
  })

  describe('la note', () => {
    it('écrit la moyenne à la française, avec le nombre d’avis', () => {
      card()

      expect(screen.getByText('4,5')).toBeInTheDocument()
      expect(screen.getByText('2 avis')).toBeInTheDocument()
    })

    it('écrit « 1 avis » au singulier', () => {
      card({ rating: { average: 5, count: 1 } })

      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('1 avis')).toBeInTheDocument()
    })

    it('n’affiche jamais « 0 sur 5 » : sans note, on le dit', () => {
      card({ rating: null })

      expect(screen.getByText('Pas encore noté')).toBeInTheDocument()
      expect(screen.queryByText(/avis/)).not.toBeInTheDocument()
    })
  })

  describe('la disponibilité', () => {
    it('annonce qu’on peut commander maintenant', () => {
      card()

      expect(screen.getByText('Commandable maintenant')).toBeInTheDocument()
    })

    it.each([
      ['SERVICE_NOT_OPEN', 'Service fermé pour le moment'],
      ['TOO_LATE_TO_DELIVER', 'Trop tard pour aujourd’hui'],
      ['PARTNER_CLOSED_AT_THAT_TIME', 'Ferme avant la livraison'],
      ['NO_MENU_FOR_DATE', 'Pas de menu aujourd’hui'],
    ] as const)('explique pourquoi c’est fermé : %s', (reason, label) => {
      card({ availability: { available: false, reason } })

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByText('Commandable maintenant')).not.toBeInTheDocument()
    })

    it('n’annonce pas de menu quand il n’y en a pas', () => {
      card({
        todaysMenu: { count: 0, preview: [] },
        availability: { available: false, reason: 'NO_MENU_FOR_DATE' },
      })

      expect(screen.queryByRole('list', { name: 'Menu du jour' })).not.toBeInTheDocument()
    })
  })
})
