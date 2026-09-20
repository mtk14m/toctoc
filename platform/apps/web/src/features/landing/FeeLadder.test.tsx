import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatGnf } from '../../lib/money'
import { FeeLadder } from './FeeLadder'

describe('FeeLadder — la livraison qui baisse à chaque palier', () => {
  it('montre les quatre paliers, du plus cher au plancher', () => {
    render(<FeeLadder />)

    const steps = within(
      screen.getByRole('list', { name: 'Frais de livraison par palier' }),
    ).getAllByRole('listitem')

    expect(steps).toHaveLength(4)
    const exact = { normalizer: (text: string) => text }
    expect(within(steps[0]!).getByText(formatGnf(6000), exact)).toBeInTheDocument()
    expect(within(steps[1]!).getByText(formatGnf(5000), exact)).toBeInTheDocument()
    expect(within(steps[2]!).getByText(formatGnf(4000), exact)).toBeInTheDocument()
    expect(within(steps[3]!).getByText(formatGnf(3000), exact)).toBeInTheDocument()
  })

  it('dit à qui s’applique chaque palier, à la française', () => {
    render(<FeeLadder />)

    expect(screen.getByText('1re – 2e personne')).toBeInTheDocument()
    expect(screen.getByText('3e – 5e personne')).toBeInTheDocument()
    expect(screen.getByText('6e – 9e personne')).toBeInTheDocument()
    expect(screen.getByText('Dès la 10e personne')).toBeInTheDocument()
  })
})
