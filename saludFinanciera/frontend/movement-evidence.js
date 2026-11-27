import { LitElement, html, css } from 'lit'
import { apiRequest } from '../../src/api.js'

const actionPaths = {
  refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
  trash: 'M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7m4-7v7',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4',
  back: 'm14 5-7 7 7 7M7 12h14',
  external: 'M14 4h6v6m0-6-9 9M20 13v7H4V4h7',
  close: 'M5 5l14 14M19 5 5 19',
}

function actionIcon(name) {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d=${actionPaths[name]} /></svg>`
}

export class MovementEvidence extends LitElement {
  static properties = {
    movementId: { type: Number }, readOnly: { type: Boolean }, expanded: { type: Boolean },
    images: { state: true }, pending: { state: true }, error: { state: true },
    loading: { state: true }, busy: { state: true }, canManage: { state: true },
    locked: { type: Boolean },
    hideToggle: { type: Boolean },
    hasEvidence: { type: Boolean },
    selectedImageId: { state: true },
  }
  static styles = css`
    :host { display: inline-block; font-size: 12px; color: var(--ink); }
    button, input { font: inherit; }
    button { padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px;
      color: var(--ink); background: var(--surface); cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    .panel { min-width: 180px; padding: 10px 0; }
    dialog { width: min(600px, calc(100% - 32px)); max-height: calc(100vh - 40px);
      overflow: auto; padding: 20px; border: 1px solid var(--line); border-radius: 14px;
      background: var(--surface); color: var(--ink); }
    dialog::backdrop { background: #0009; }
    .dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .dialog-heading h2 { margin: 0; font-size: 18px; }
    .eye-button { display: inline-flex; align-items: center; justify-content: center; }
    .eye-button.has-evidence {
      border-color: var(--positive); background: var(--positive); color: var(--on-accent);
    }
    .action-button { display: inline-flex; align-items: center; gap: 6px; }
    .action-button svg { flex: none; }
    dialog.detail-dialog { width: min(950px, calc(100% - 32px)); }
    .gallery { display: flex; flex-wrap: wrap; gap: 12px; margin: 10px 0; }
    figure { margin: 0; max-width: 140px; overflow-wrap: anywhere; }
    .image-thumb { display: grid; gap: 5px; max-width: 140px; text-align: left; }
    .image-thumb img { display: block; max-width: 100%; height: 95px; object-fit: contain; background: var(--soft); }
    .image-detail { display: grid; gap: 12px; justify-items: start; min-width: 0; }
    .image-detail img { display: block; width: 100%; max-height: calc(100dvh - 220px);
      min-height: 120px; object-fit: contain; background: var(--soft); }
    .image-detail strong { overflow-wrap: anywhere; }
    a { color: var(--transfer); }
    label { display: grid; gap: 8px; }
    input { max-width: 100%; }
    ul { padding-left: 18px; overflow-wrap: anywhere; }
    p { white-space: normal; line-height: 1.5; }
    .error { color: var(--negative); }
  `

  constructor() {
    super()
    this.movementId = null
    this.readOnly = false
    this.expanded = false
    this.images = []
    this.pending = []
    this.error = ''
    this.loading = false
    this.busy = false
    this.canManage = false
    this.hasEvidence = false
    this.selectedImageId = null
    this.requestVersion = 0
  }

  updated(changed) {
    if (changed.has('movementId')) {
      this.images = []
      this.selectedImageId = null
      this.canManage = false
      this.requestVersion++
    }
    if (this.expanded && this.movementId && (changed.has('expanded') || changed.has('movementId'))) this.load()
  }

  endpoint(id = this.movementId) {
    return `/api/movements/${id}/evidence`
  }

  async load() {
    const version = ++this.requestVersion
    this.loading = true
    this.error = ''
    try {
      const data = await apiRequest(this.endpoint())
      if (version === this.requestVersion) {
        this.images = data.images
        if (!data.images.some((image) => image.id === this.selectedImageId)) this.selectedImageId = null
        this.hasEvidence = data.images.length > 0
        this.canManage = data.canManage
      }
    } catch (error) {
      if (version === this.requestVersion) this.error = error.message
    } finally {
      if (version === this.requestVersion) this.loading = false
    }
  }

  selectFiles(event) {
    this.error = ''
    const files = [...event.currentTarget.files]
    event.currentTarget.value = ''
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) {
      this.error = 'Selecciona imágenes JPG, PNG o WebP de hasta 5 MB cada una.'
      return
    }
    if (this.images.length + this.pending.length + files.length > 5) {
      this.error = 'Cada movimiento admite hasta 5 imágenes.'
      return
    }
    this.pending = [...this.pending, ...files]
  }

  async uploadPending(movementId) {
    this.busy = true
    this.error = ''
    try {
      while (this.pending.length) {
        const file = this.pending[0]
        const { image } = await apiRequest(this.endpoint(movementId), {
          method: 'POST', body: file,
          headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        })
        this.images = [...this.images, image]
        this.hasEvidence = true
        this.pending = this.pending.slice(1)
      }
    } catch (error) {
      this.error = error.message
      throw error
    } finally {
      this.busy = false
    }
  }

  async upload() {
    try { await this.uploadPending(this.movementId) } catch { return }
  }

  async remove(image) {
    if (!window.confirm(`¿Eliminar la evidencia «${image.name}»?`)) return
    this.busy = true
    this.error = ''
    try {
      await apiRequest(`${this.endpoint()}/${image.id}`, { method: 'DELETE' })
      this.images = this.images.filter((item) => item.id !== image.id)
      if (this.selectedImageId === image.id) this.selectedImageId = null
      this.hasEvidence = this.images.length > 0
    } catch (error) {
      this.error = error.message
    } finally {
      this.busy = false
    }
  }

  open() {
    this.renderRoot.querySelector('dialog').showModal()
    this.expanded = true
  }

  close() {
    this.renderRoot.querySelector('dialog').close()
  }

  handleClose() {
    this.expanded = false
    this.selectedImageId = null
    this.requestVersion++
    this.loading = false
  }

  showImage(image) {
    this.error = ''
    this.selectedImageId = image.id
  }

  renderPanel() {
    const manage = !this.readOnly && (!this.movementId || this.canManage)
    const selectedImage = this.images.find((image) => image.id === this.selectedImageId)
    if (selectedImage) return html`
      <div class="panel image-detail">
        <button class="action-button" type="button" @click=${() => { this.selectedImageId = null }}>
          ${actionIcon('back')} Volver a imágenes
        </button>
        <strong>${selectedImage.name}</strong>
        <img src=${`${this.endpoint()}/${selectedImage.id}`} alt=${selectedImage.name}
          @error=${() => { this.error = 'No se pudo cargar una imagen. Actualiza la evidencia para comprobar el acceso.' }} />
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        <a class="action-button" href=${`${this.endpoint()}/${selectedImage.id}`}
          target="_blank" rel="noopener noreferrer">${actionIcon('external')} Abrir en otra pestaña</a>
        ${manage ? html`<button class="action-button" type="button" ?disabled=${this.busy || this.locked}
          @click=${() => this.remove(selectedImage)}>${actionIcon('trash')} Eliminar imagen</button>` : ''}
      </div>
    `
    return html`
        <div class="panel">
          ${this.loading ? html`<p role="status">Cargando evidencia…</p>` : ''}
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          ${this.movementId ? html`<button class="action-button" type="button" ?disabled=${this.busy || this.loading}
            @click=${this.load}>${actionIcon('refresh')} Actualizar evidencia</button>` : ''}
          <div class="gallery">${this.images.map((image) => html`
            <figure>
              <button class="image-thumb" type="button" @click=${() => this.showImage(image)}>
                <img src=${`${this.endpoint()}/${image.id}`} alt=${image.name} loading="lazy"
                  @error=${() => { this.error = 'No se pudo cargar una imagen. Actualiza la evidencia para comprobar el acceso.' }} />
                ${image.name}
              </button>
              ${manage ? html`<button class="action-button" type="button" ?disabled=${this.busy || this.locked}
                @click=${() => this.remove(image)}>${actionIcon('trash')} Eliminar imagen</button>` : ''}
            </figure>
          `)}</div>
          ${!this.loading && !this.images.length && !this.error ? html`<p>Sin imágenes adjuntas.</p>` : ''}
          ${manage ? html`
            <label><span class="action-button">${actionIcon('upload')} Imágenes de evidencia (opcional)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple
                ?disabled=${this.busy || this.loading || this.locked} @change=${this.selectFiles} />
            </label>
            <p>Hasta 5 imágenes por movimiento y 5 MB por imagen. Las mayores de 20 megapíxeles se reducen automáticamente (máximo 100 megapíxeles).
              Se guardan en WebP sin metadatos de ubicación. No se admiten animaciones.
              Solo tú y tu familia autorizada pueden consultarlas.</p>
            ${this.pending.length ? html`
              <ul>${this.pending.map((file, index) => html`<li>${file.name}
                <button class="action-button" type="button" ?disabled=${this.busy || this.locked} @click=${() => {
                  this.pending = this.pending.filter((_, position) => position !== index)
                }}>${actionIcon('close')} Quitar</button>
              </li>`)}</ul>
              ${this.movementId ? html`<button class="action-button" type="button"
                ?disabled=${this.busy || this.loading || this.locked} @click=${this.upload}>
                ${actionIcon('upload')} ${this.busy ? 'Subiendo…' : 'Subir imágenes'}
              </button>` : html`<p>Se subirán al guardar el movimiento.</p>`}
            ` : ''}
          ` : ''}
        </div>
    `
  }

  render() {
    return this.hideToggle ? this.renderPanel() : html`
      <button class="eye-button ${this.hasEvidence ? 'has-evidence' : ''}" type="button"
        aria-label=${this.hasEvidence ? 'Ver evidencia adjunta' : 'Ver evidencia'}
        title=${this.hasEvidence ? 'Ver evidencia adjunta' : 'Ver evidencia'}
        @click=${this.open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <dialog aria-label="Evidencia del movimiento" class=${this.selectedImageId != null ? 'detail-dialog' : ''}
        @close=${this.handleClose}
        @cancel=${(event) => { if (this.busy) event.preventDefault() }}>
        <div class="dialog-heading">
          <h2>Evidencia</h2>
          <button class="action-button" type="button" ?disabled=${this.busy}
            @click=${this.close}>${actionIcon('close')} Cerrar</button>
        </div>
        ${this.expanded ? this.renderPanel() : ''}
      </dialog>
    `
  }
}

customElements.define('movement-evidence', MovementEvidence)
