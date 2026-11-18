export const themes = [
  { id: 'verde', label: 'Verde' },
  { id: 'azul', label: 'Azul' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'oscuro', label: 'Oscuro' },
]

export const maxPhotoBytes = 256 * 1024

export function isValidPhoto(photo) {
  if (typeof photo !== 'string') return false
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
    const encoded = photo.slice(photo.indexOf(',') + 1)
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
    if (encoded.length % 4 !== 0 || bytes > maxPhotoBytes) return false
    const prefix = encoded.slice(0, 16)
    return photo.startsWith('data:image/jpeg;') ? prefix.startsWith('/9j/')
      : photo.startsWith('data:image/png;') ? prefix.startsWith('iVBORw0KGgo')
        : prefix.startsWith('UklGR') && encoded.slice(12, 16) === 'RUJQ'
  }
  if (photo.length > 2048) return false
  try {
    const url = new URL(photo)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
