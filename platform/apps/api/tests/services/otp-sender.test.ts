import { describe, expect, it, vi } from 'vitest'
import { ConsoleOtpSender } from '../../src/services/otp-sender.js'

describe('ConsoleOtpSender', () => {
  it('écrit le numéro et le code dans les logs (en attendant l’envoi WhatsApp)', async () => {
    const log = vi.fn()

    await new ConsoleOtpSender(log).send('+224621000000', '123456')

    const output = log.mock.calls.map(([line]) => line).join('\n')
    expect(output).toContain('+224621000000')
    expect(output).toContain('123456')
  })
})
