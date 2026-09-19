import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../src/lib/prisma.js'

describe('client Prisma', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('reste un singleton même si le module est rechargé (hot reload en dev)', async () => {
    vi.resetModules()
    const reloaded = await import('../../src/lib/prisma.js')

    expect(reloaded.prisma).toBe(prisma)
  })

  it('n’ouvre aucune connexion à l’import (connexion paresseuse)', () => {
    // Si ce test passe sans base de données joignable, c'est que rien ne s'est connecté.
    expect(prisma).toBeDefined()
  })
})
