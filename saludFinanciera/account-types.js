function normalizedType(type) {
  return String(type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function isCreditAccount(type) {
  return normalizedType(type).includes('credito')
}

export function isDebitAccount(type) {
  const value = normalizedType(type)
  return value.includes('debito') || value.includes('nomina')
}

export function isCashAccount(type) {
  return normalizedType(type).trim() === 'efectivo'
}

export function isMoneyAccount(type) {
  return isDebitAccount(type) || isCashAccount(type)
}
