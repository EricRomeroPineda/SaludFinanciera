import { LitElement, html, css } from 'lit'
import { apiRequest } from '../../src/api.js'

const resolutions = new Map()
export function invalidateCardImages() {
  resolutions.clear()
  globalThis.dispatchEvent?.(new Event('card-catalog-changed'))
}

class CardCatalogImage extends LitElement {
  static properties = { name: { type: String }, type: { type: String }, source: { state: true }, loaded: { state: true } }
  static styles = css`
    :host { display: none; }
    :host([loaded]) { display: block; width: 40px; height: 40px; margin: 0 0 10px; flex: none; }
    img { display: block; width: 40px; height: 40px; border-radius: 8px; object-fit: contain; object-position: center; }
  `
  constructor() {
    super()
    this.source = ''
    this.loaded = false
    this.reload = () => this.resolve()
  }
  connectedCallback() {
    super.connectedCallback()
    globalThis.addEventListener?.('card-catalog-changed', this.reload)
    if (this.hasUpdated) this.resolve()
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    this.version = (this.version || 0) + 1
    globalThis.removeEventListener?.('card-catalog-changed', this.reload)
  }
  updated(changed) {
    if (changed.has('name') || changed.has('type')) this.resolve()
  }
  async resolve() {
    const version = this.version = (this.version || 0) + 1
    this.loaded = false
    this.removeAttribute('loaded')
    this.source = ''
    if (!this.name || !this.type) return
    const key = JSON.stringify([this.name, this.type])
    try {
      if (!resolutions.has(key)) {
        resolutions.set(key, apiRequest(`/api/card-images/resolve?name=${encodeURIComponent(this.name)}&type=${encodeURIComponent(this.type)}`))
      }
      const { imageUrl } = await resolutions.get(key)
      if (version === this.version) this.source = imageUrl || ''
    } catch (error) {
      resolutions.delete(key)
      console.error('[CATALOGO] No se pudo consultar la imagen de tarjeta:', error.message)
    }
  }
  render() {
    return this.source ? html`<img src=${this.source} alt="" width="40" height="40"
      @load=${() => { this.loaded = true; this.setAttribute('loaded', '') }}
      @error=${() => {
        this.loaded = false
        this.removeAttribute('loaded')
        console.error('[CATALOGO] Imagen no disponible; se conserva la tarjeta sin imagen.')
      }} />` : ''
  }
}
customElements.define('card-catalog-image', CardCatalogImage)

export function renderCardImage(name, type) {
  return html`<card-catalog-image .name=${name} .type=${type}></card-catalog-image>`
}
