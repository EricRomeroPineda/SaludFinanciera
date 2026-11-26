export const themes = [
  { id: 'verde', label: 'Verde' },
  { id: 'azul', label: 'Azul' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'turquesa', label: 'Turquesa' },
  { id: 'rosa', label: 'Rosa' },
  { id: 'naranja', label: 'Naranja' },
  { id: 'rojo', label: 'Rojo' },
  { id: 'dorado', label: 'Dorado' },
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
