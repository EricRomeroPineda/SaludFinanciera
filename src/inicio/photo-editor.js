import { LitElement, html, css } from 'lit'

class PhotoEditor extends LitElement {
  static properties = {
    src: {}, source: { state: true }, error: { state: true }, busy: { state: true },
    zoom: { state: true }, angle: { state: true }, flipX: { state: true }, flipY: { state: true },
    positionX: { state: true }, positionY: { state: true },
  }

  static styles = css`
    dialog { box-sizing: border-box; width: min(460px, calc(100% - 24px)); max-height: calc(100dvh - 24px);
      overflow: auto; padding: 24px; border: 1px solid var(--line); border-radius: 16px;
      background: var(--surface, white); color: var(--ink, #172b26); }
    dialog::backdrop { background: #000a; }
    h2 { margin: 0 0 16px; font-size: 20px; }
    canvas { display: block; width: min(100%, 300px); height: auto; aspect-ratio: 1; border-radius: 50%;
      margin: 16px auto; background: #ddd; outline: 2px solid var(--line, #888); }
    label { display: grid; gap: 5px; margin: 14px 0; font-size: 14px; }
    input[type=range] { width: 100%; accent-color: var(--green, #147d64); }
    .tools, .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    button { padding: 9px 12px; border: 1px solid var(--line, #888); border-radius: 8px;
      background: var(--surface, white); color: inherit; cursor: pointer; font: inherit; font-size: 14px; }
    button:disabled { opacity: .5; cursor: default; }
    .apply { background: var(--green, #147d64); color: var(--on-accent, white); }
    .error { color: var(--danger, #b42318); }
    p { font-size: 13px; line-height: 1.5; }
  `

  constructor() {
    super()
    this.busy = false
    this.reset()
  }

  reset() {
    this.zoom = 1
    this.angle = 0
    this.flipX = false
    this.flipY = false
    this.positionX = 0
    this.positionY = 0
  }

  async open() {
    await this.updateComplete
    this.renderRoot.querySelector('dialog').showModal()
    this.error = ''
    this.image = null
    this.source = ''
    this.reset()
    if (this.src) await this.load(this.src)
  }

  async load(src) {
    const generation = this.generation = (this.generation || 0) + 1
    this.busy = true
    this.error = ''
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = src
      await image.decode()
      if (generation !== this.generation) return
      if (image.naturalWidth * image.naturalHeight > 100000000) throw new Error('La imagen supera el límite de seguridad de 100 megapíxeles.')
      if (image.naturalWidth * image.naturalHeight > 20000000) {
        const scale = Math.sqrt(20000000 / (image.naturalWidth * image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(image.naturalWidth * scale)
        canvas.height = Math.floor(image.naturalHeight * scale)
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        const reduced = new Image()
        reduced.src = canvas.toDataURL('image/webp', .9)
        await reduced.decode()
        if (generation !== this.generation) return
        this.image = reduced
      } else {
        this.image = image
      }
      this.source = src
      this.reset()
      await this.updateComplete
      this.draw()
    } catch (error) {
      if (generation !== this.generation) return
      this.error = error.message === 'La imagen supera el límite de seguridad de 100 megapíxeles.' ? error.message
        : 'No se pudo abrir la imagen para editarla. Selecciona un archivo JPG, PNG o WebP de tu equipo.'
    } finally {
      if (generation === this.generation) this.busy = false
    }
  }

  async select(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      this.error = 'Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.'
      return
    }
    const url = URL.createObjectURL(file)
    try { await this.load(url) } finally { URL.revokeObjectURL(url) }
  }

  updated() {
    this.draw()
  }

  draw() {
    const canvas = this.renderRoot.querySelector('canvas')
    if (!canvas) return
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!this.image) return
    const size = canvas.width
    const { naturalWidth: width, naturalHeight: height } = this.image
    const rotated = this.angle % 180 !== 0
    const scale = Math.max(size / (rotated ? height : width), size / (rotated ? width : height)) * this.zoom
    const overflowX = Math.max(0, (rotated ? height : width) * scale - size) / 2
    const overflowY = Math.max(0, (rotated ? width : height) * scale - size) / 2
    context.save()
    context.translate(size / 2 + overflowX * this.positionX / 100, size / 2 + overflowY * this.positionY / 100)
    context.rotate(this.angle * Math.PI / 180)
    context.scale(scale * (this.flipX ? -1 : 1), scale * (this.flipY ? -1 : 1))
    context.drawImage(this.image, -width / 2, -height / 2)
    context.restore()
  }

  close() {
    this.generation = (this.generation || 0) + 1
    this.busy = false
    this.image = null
    this.source = ''
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.close()
  }

  async apply() {
    if (this.busy || !this.image) return
    this.busy = true
    const generation = this.generation
    try {
      const canvas = this.renderRoot.querySelector('canvas')
      this.draw()
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .9))
      if (!blob) throw new Error('No se pudo generar la foto editada.')
      if (generation !== this.generation) return
      this.dispatchEvent(new CustomEvent('photo-edited', { detail: blob, bubbles: true, composed: true }))
      this.renderRoot.querySelector('dialog').close()
    } catch (error) {
      this.error = error.message
    } finally {
      this.busy = false
    }
  }

  render() {
    return html`<dialog aria-labelledby="photo-title" @close=${this.close} @cancel=${this.close}>
      <h2 id="photo-title">Ajustar foto de perfil</h2>
      <p>Las imágenes de más de 20 megapíxeles se reducen automáticamente. Máximo 5 MB y 100 megapíxeles.</p>
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden @change=${this.select} />
      <button type="button" ?disabled=${this.busy}
        @click=${() => this.renderRoot.querySelector('input[type=file]').click()}>Seleccionar otra foto</button>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.busy ? html`<p role="status">Procesando imagen…</p>` : ''}
      <canvas width="600" height="600" role="img" aria-label="Vista previa circular de la foto"></canvas>
      <label>Zoom ${Number(this.zoom).toFixed(1)}×
        <input aria-label="Zoom" type="range" min="1" max="4" step=".05" .value=${String(this.zoom)}
          ?disabled=${!this.source || this.busy} @input=${(event) => { this.zoom = Number(event.target.value) }} /></label>
      <label>Posición horizontal
        <input aria-label="Posición horizontal" type="range" min="-100" max="100" .value=${String(this.positionX)}
          ?disabled=${!this.source || this.busy} @input=${(event) => { this.positionX = Number(event.target.value) }} /></label>
      <label>Posición vertical
        <input aria-label="Posición vertical" type="range" min="-100" max="100" .value=${String(this.positionY)}
          ?disabled=${!this.source || this.busy} @input=${(event) => { this.positionY = Number(event.target.value) }} /></label>
      <div class="tools">
        <button type="button" ?disabled=${!this.source || this.busy} @click=${() => { this.angle = (this.angle + 90) % 360 }}>Girar 90°</button>
        <button type="button" aria-pressed=${String(this.flipX)} ?disabled=${!this.source || this.busy}
          @click=${() => { this.flipX = !this.flipX }}>Invertir horizontal</button>
        <button type="button" aria-pressed=${String(this.flipY)} ?disabled=${!this.source || this.busy}
          @click=${() => { this.flipY = !this.flipY }}>Invertir vertical</button>
        <button type="button" ?disabled=${!this.source || this.busy} @click=${this.reset}>Restablecer</button>
      </div>
      <p>El círculo muestra cómo se verá tu foto. Aplica el ajuste y pulsa Guardar perfil para subirla al servidor.</p>
      <div class="actions">
        <button type="button" @click=${() => this.renderRoot.querySelector('dialog').close()}>Cancelar</button>
        <button class="apply" type="button" ?disabled=${!this.source || this.busy} @click=${this.apply}>Aplicar foto</button>
      </div>
    </dialog>`
  }
}

customElements.define('photo-editor', PhotoEditor)
