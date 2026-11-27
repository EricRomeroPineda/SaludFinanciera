export const catalogScopes = [
  ['banco', 'Banco (todas sus cuentas)'], ['credito', 'Tarjeta de crédito'],
  ['debito', 'Cuenta de débito'], ['nomina', 'Cuenta de nómina'], ['efectivo', 'Efectivo'],
  ['servicio', 'Servicio'], ['suscripcion', 'Suscripción'], ['plan', 'Plan futuro'],
]

export function normalizeCardName(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

export function cardScope(type) {
  const normalized = normalizeCardName(type)
  if (normalized.includes('credito')) return 'credito'
  if (normalized.includes('nomina')) return 'nomina'
  if (normalized.includes('debito')) return 'debito'
  if (normalized === 'servicio') return 'servicio'
  if (normalized === 'suscripcion') return 'suscripcion'
  if (normalized === 'plan') return 'plan'
  if (normalized === 'efectivo') return 'efectivo'
  return null
}

export function phraseMatches(name, phrase) {
  const normalized = normalizeCardName(phrase)
  return Boolean(normalized) && ` ${normalizeCardName(name)} `.includes(` ${normalized} `)
}

export function resolveCardRule(rules, name, type) {
  const scope = cardScope(type)
  if (!scope) return null
  const matches = []
  for (const rule of rules) {
    if (rule.scope !== scope && !(rule.scope === 'banco' && ['credito', 'debito', 'nomina'].includes(scope))) continue
    const aliases = [rule.keyword, ...(rule.aliases || [])].map(normalizeCardName)
    const matching = aliases.filter((alias) => phraseMatches(name, alias))
    if (!matching.length) continue
    matches.push({ rule, rank: rule.kind === 'producto' && scope === 'credito' ? 2 : rule.scope === scope ? 1 : 0,
      length: Math.max(...matching.map((alias) => alias.length)) })
  }
  matches.sort((a, b) => b.rank - a.rank || b.length - a.length || Number(a.rule.id) - Number(b.rule.id))
  return matches[0]?.rule || null
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

export function similarCardNames(a, b) {
  const left = normalizeCardName(a)
  const right = normalizeCardName(b)
  if (!left || !right || left === right || Math.min(left.length, right.length) < 3) return false
  return distance(left, right) <= (Math.max(left.length, right.length) <= 8 ? 2 : 1)
}

export function aliasSuggestions(rules, entries) {
  const suggestions = []
  for (const rule of rules) {
    const key = normalizeCardName(rule.keyword)
    for (const entry of entries) {
      if (rule.scope !== entry.scope && !(rule.scope === 'banco' && ['credito', 'debito', 'nomina'].includes(entry.scope))) continue
      const words = normalizeCardName(entry.name).split(' ')
      const length = key.split(' ').length
      for (let i = 0; i <= words.length - length; i++) {
        const phrase = words.slice(i, i + length).join(' ')
        if (similarCardNames(key, phrase) && !rules.some((other) =>
          other.scope === rule.scope && [other.keyword, ...(other.aliases || [])].some((alias) => normalizeCardName(alias) === phrase))) {
          if (!suggestions.some((item) => item.ruleId === rule.id && item.alias === phrase)) {
            suggestions.push({ ruleId: rule.id, keyword: rule.keyword, alias: phrase, name: entry.name, type: entry.type })
          }
        }
      }
    }
  }
  return suggestions
}
