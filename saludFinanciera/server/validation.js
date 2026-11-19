import { parseScheduleDate } from '../schedule.js'

export function invalid(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export function requiredText(value, label, maxLength) {
  const text = String(value || '').trim()
  if (!text || text.length > maxLength) {
    throw invalid(`${label} es obligatorio y no debe exceder ${maxLength} caracteres.`)
  }
  return text
}

export function depositDetails(value) {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid('Los datos de depósito admiten hasta 500 caracteres de texto, sin caracteres de control.')
  }
  return value.trim() || null
}

export function decimal(value, label, allowZero = false) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw invalid(`${label} debe tener hasta 13 dígitos y 2 decimales como máximo.`)
  }
  if (!allowZero && Number(text) <= 0) throw invalid(`${label} debe ser mayor que cero.`)
  return text
}

export function positiveId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid(`${label} no es válido.`)
  return id
}

export function requiredDate(value, label) {
  if (!parseScheduleDate(value)) throw invalid(`${label} debe ser una fecha válida (AAAA-MM-DD).`)
  return value
}
