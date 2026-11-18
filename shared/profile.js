export const themes = [
  { id: 'verde', label: 'Verde' },
  { id: 'azul', label: 'Azul' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'oscuro', label: 'Oscuro' },
]

export function isValidPhoto(photo) {
  if (typeof photo !== 'string' || photo.length > 500) return false
  try {
    const url = new URL(photo)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
