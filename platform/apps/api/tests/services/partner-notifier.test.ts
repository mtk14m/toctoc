import { describe, expect, it, vi } from 'vitest'
import { ConsolePartnerNotifier } from '../../src/services/partner-notifier.js'

describe('ConsolePartnerNotifier', () => {
  it('écrit le destinataire et le récap dans les logs (en attendant WhatsApp / SMS)', async () => {
    const log = vi.fn()

    await new ConsolePartnerNotifier(log).sendRecap(
      { name: 'Chez Aïssatou', phone: '+224622000000' },
      '2× Riz gras\nTotal : 2 plats',
    )

    const output = log.mock.calls.map(([line]) => line).join('\n')
    expect(output).toContain('Chez Aïssatou')
    expect(output).toContain('+224622000000')
    expect(output).toContain('2× Riz gras')
    expect(output).toContain('Total : 2 plats')
  })
})
