import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeCardName, phraseMatches, resolveCardRule, aliasSuggestions, similarCardNames } from './card-catalog.js'

const bank = { id: 1, keyword: 'BBVA', scope: 'banco', kind: 'general', aliases: ['Bbbv'] }
const product = { id: 2, keyword: 'BBVA Vive', scope: 'credito', kind: 'producto', aliases: ['BBVA Vivee'] }
const blue = { id: 3, keyword: 'BBVA Azul', scope: 'credito', kind: 'producto', aliases: [] }

test('catalog normalization ignores case, accents, surrounding/repeated spaces and separators', () => {
  for (const value of [' BBVA  Nómina ', 'bbva_nomina', 'BbVa-NOMINA', 'BBVA / Nómina', 'BBVA.Nómina']) {
    assert.equal(normalizeCardName(value), 'bbva nomina')
  }
  assert.equal(phraseMatches('Mi cuenta Bbva', ' BBVA '), true)
  assert.equal(phraseMatches('BBVAX', 'BBVA'), false)
  assert.equal(phraseMatches('BBVA Vivero', 'BBVA Vive'), false)
  assert.equal(phraseMatches('BBVA', ''), false)
})

test('bank matches payroll/debit/credit; credit products override bank with bank fallback', () => {
  const rules = [bank, product, blue]
  for (const name of ['BBVA Nómina', 'bbva', 'Mi cuenta Bbva']) {
    assert.equal(resolveCardRule(rules, name, 'Cuenta de nómina'), bank)
  }
  assert.equal(resolveCardRule(rules, 'BBVA Vive', 'Tarjeta de crédito'), product)
  assert.equal(resolveCardRule(rules, 'BBVA-Vivee', 'Crédito'), product)
  assert.equal(resolveCardRule(rules, 'BBVA Azul', 'Crédito'), blue)
  assert.equal(resolveCardRule(rules, 'BBVA Oro', 'Crédito'), bank)
  assert.equal(resolveCardRule(rules, 'BBVA Vive', 'Débito'), bank)
  assert.equal(resolveCardRule(rules, 'Bbbv nómina', 'Nómina'), bank)
  assert.equal(resolveCardRule(rules, 'BBVA', 'Servicio'), null)
  assert.equal(resolveCardRule(rules, 'Sin coincidencia', 'Débito'), null)
  assert.equal(resolveCardRule(rules, 'BBVA', 'desconocido'), null)
})

test('longest phrase wins within a scope, independent of rule order', () => {
  const general = { id: 8, keyword: 'BBVA', scope: 'credito', kind: 'general' }
  const specific = { id: 9, keyword: 'BBVA Vive', scope: 'credito', kind: 'general' }
  assert.equal(resolveCardRule([general, specific], 'Mi BBVA Vive', 'Crédito'), specific)
  assert.equal(resolveCardRule([specific, general], 'Mi BBVA Vive', 'Crédito'), specific)
})

test('real registered spellings are suggestions only, never automatic fuzzy matches', () => {
  const rules = [{ ...bank, aliases: [] }, { ...product, aliases: [] }]
  const names = [
    { name: 'Mi Bbbv Nómina', type: 'Nómina', scope: 'nomina' },
    { name: 'BBVA Vivee', type: 'Crédito', scope: 'credito' },
  ]
  const suggestions = aliasSuggestions(rules, names)
  assert.ok(suggestions.some((entry) => entry.ruleId === bank.id && entry.alias === 'bbbv'))
  assert.ok(suggestions.some((entry) => entry.ruleId === product.id && entry.alias === 'bbva vivee'))
  assert.equal(resolveCardRule(rules, 'Bbbv nómina', 'Nómina'), null)
  assert.equal(resolveCardRule(rules, 'BBVA Vivee', 'Crédito').id, bank.id)
  assert.equal(similarCardNames('BBVA', 'Bbbv'), true)
  assert.equal(similarCardNames('Vive', 'Vivee'), true)
  assert.equal(similarCardNames('BBVA', 'bbva'), false)
  assert.equal(aliasSuggestions([bank, product], names).length, 0)
})

test('alias namespace is scoped and existing aliases are not suggested for another rule', () => {
  const rules = [
    { ...bank, aliases: [] },
    { id: 4, keyword: 'Otro banco', scope: 'banco', aliases: ['Bbbv'] },
    { id: 5, keyword: 'Renta', scope: 'servicio', aliases: [] },
  ]
  assert.equal(aliasSuggestions(rules, [{ name: 'Bbbv', type: 'Nómina', scope: 'nomina' }])
    .some((entry) => entry.ruleId === bank.id), false)
  assert.equal(resolveCardRule(rules, 'Renta', 'Servicio').id, 5)
  assert.equal(resolveCardRule(rules, 'Renta', 'Suscripción'), null)
})
