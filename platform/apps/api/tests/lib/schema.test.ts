import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Garde-fous sur le schéma (docs/08-schema-donnees.md) : ce sont des décisions,
 * pas des détails — les casser silencieusement fausserait la comptabilité.
 *
 * On lit schema.prisma directement (la source de vérité) plutôt que les internals du client généré.
 */
const schemaSource = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
)

interface Field {
  type: string
  attributes: string
}

function parseModels(source: string): Map<string, Map<string, Field>> {
  const models = new Map<string, Map<string, Field>>()

  for (const [, name, body] of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = new Map<string, Field>()
    for (const rawLine of body!.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line || line.startsWith('@@')) continue
      const [fieldName, fieldType, ...rest] = line.split(/\s+/)
      if (fieldName && fieldType) {
        fields.set(fieldName, {
          type: fieldType.replace(/[?[\]]/g, ''),
          attributes: rest.join(' '),
        })
      }
    }
    models.set(name!, fields)
  }

  return models
}

const models = parseModels(schemaSource)

function getField(modelName: string, fieldName: string): Field {
  const field = models.get(modelName)?.get(fieldName)
  expect(field, `champ ${modelName}.${fieldName} introuvable`).toBeDefined()
  return field!
}

describe('schéma Prisma', () => {
  it('contient les 13 modèles de la Phase 1', () => {
    expect([...models.keys()].sort()).toEqual(
      [
        'AuditLog',
        'Delivery',
        'Document',
        'Driver',
        'GroupOrder',
        'MenuItem',
        'OrderItem',
        'OtpCode',
        'Partner',
        'Payment',
        'Payout',
        'Rating',
        'User',
      ].sort(),
    )
  })

  it.each([
    ['MenuItem', 'price'],
    ['OrderItem', 'unitPrice'],
    ['OrderItem', 'deliveryFee'],
    ['OrderItem', 'commissionAmount'],
    ['Payment', 'amount'],
    ['Payout', 'amount'],
  ])(
    '%s.%s est un entier (le GNF n’a pas de sous-unité, pas de Float pour l’argent)',
    (model, field) => {
      expect(getField(model, field).type).toBe('Int')
    },
  )

  it('aucun champ Float ne porte un montant', () => {
    const floatFields = [...models].flatMap(([model, fields]) =>
      [...fields].filter(([, f]) => f.type === 'Float').map(([name]) => `${model}.${name}`),
    )

    // Les seuls Float autorisés : un ratio (commission) et des coordonnées GPS.
    expect(floatFields.sort()).toEqual([
      'GroupOrder.deliveryLat',
      'GroupOrder.deliveryLng',
      'Partner.commissionRate',
    ])
  })

  it('GroupOrder.shareToken est unique (c’est le lien partagé)', () => {
    expect(getField('GroupOrder', 'shareToken').attributes).toContain('@unique')
  })

  it('un lien est en mode SPLIT et OPEN par défaut', () => {
    expect(getField('GroupOrder', 'paymentMode').attributes).toContain('@default(SPLIT)')
    expect(getField('GroupOrder', 'status').attributes).toContain('@default(OPEN)')
  })

  it('Payment est en GNF par défaut et un seul Payment par OrderItem', () => {
    expect(getField('Payment', 'currency').attributes).toContain('@default("GNF")')
    expect(getField('Payment', 'orderItemId').attributes).toContain('@unique')
  })

  it('OtpCode ne stocke jamais le code en clair, et compte les essais ratés', () => {
    expect(models.get('OtpCode')?.has('code')).toBe(false)
    expect(getField('OtpCode', 'codeHash').type).toBe('String')
    expect(getField('OtpCode', 'attempts').type).toBe('Int')
  })

  it('le client généré importe en .js, sinon `node dist/server.js` plante en production', () => {
    // Sans cette option, le client généré contient `from "./internal/class.ts"` : tsx et Vitest
    // s'en accommodent, mais tsc le recopie tel quel dans dist/ où seuls des .js existent.
    const generator = schemaSource.match(/^generator client \{([\s\S]*?)^\}/m)?.[1] ?? ''

    expect(generator).toMatch(/importFileExtension\s*=\s*"js"/)
  })

  it('User.phone est unique', () => {
    expect(getField('User', 'phone').attributes).toContain('@unique')
  })
})
