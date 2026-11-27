import { LitElement, html, css } from 'lit'
import { apiRequest } from '../../src/api.js'
import { catalogScopes } from '../../shared/card-catalog.js'
import { invalidateCardImages } from './card-catalog-image.js'

const root = '/api/admin/card-catalog'
const emptyRule = () => ({ keyword: '', scope: 'banco', kind: 'general', aliases: [], file: '' })
class CardCatalogAdmin extends LitElement {
  static properties = {
    allowed: { state: true }, data: { state: true }, files: { state: true }, draft: { state: true },
    search: { state: true }, preview: { state: true }, previewImage: { state: true },
    error: { state: true }, notice: { state: true }, storageError: { state: true }, busy: { state: true },
    sourceName: { state: true }, upload: { state: true },
  }
  static styles = css`
    :host { display: block; color: var(--ink); }
    * { box-sizing: border-box; }
    h1 { font-size: 24px; } h2 { font-size: 18px; } h3 { font-size: 14px; }
    p { line-height: 1.5; } button, input, select, textarea { font: inherit; }
    button { padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
    label { display: grid; gap: 6px; font-size: 12px; }
    input, select, textarea { width: 100%; padding: 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
    section { border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin-top: 16px; background: var(--surface); min-width: 0; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
    .form { display: grid; gap: 14px; } .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
    ul { list-style: none; padding: 0; } li { padding: 9px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
    small { display: block; color: var(--muted); line-height: 1.5; }
    .error { color: var(--negative); } .success { color: var(--positive); } .warning { padding: 12px; border: 1px solid var(--line); background: var(--soft); border-radius: 8px; }
    img { width: 80px; height: 80px; object-fit: contain; border-radius: 8px; }
    .rule { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .rule img { width: 40px; height: 40px; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  `
  constructor() {
    super()
    this.allowed = false
    this.data = null
    this.files = []
    this.draft = emptyRule()
    this.search = ''
    this.error = ''
    this.notice = ''
    this.storageError = ''
    this.previewImage = ''
    this.sourceName = ''
    this.busy = false
  }
  connectedCallback() {
    super.connectedCallback()
    this.load()
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    this.releasePreview()
  }
  releasePreview() {
    if (this.previewImage?.startsWith('blob:')) URL.revokeObjectURL(this.previewImage)
  }
  async load() {
    this.busy = true
    this.error = ''
    try {
      const { user } = await apiRequest('/api/auth/me')
      this.allowed = user.role === 'admin'
      if (!this.allowed) throw new Error('Solo un administrador puede configurar este catálogo.')
      this.data = await apiRequest(root)
      await this.loadFiles()
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  async loadFiles() {
    this.storageError = ''
    try { this.files = (await apiRequest(`${root}/files`)).files }
    catch (error) { this.storageError = error.message; this.files = [] }
  }
  change(patch) {
    this.draft = { ...this.draft, ...patch }
    this.preview = null
    this.previewVersion = (this.previewVersion || 0) + 1
  }
  edit(rule = null) {
    this.releasePreview()
    this.draft = rule ? { ...rule, aliases: [...rule.aliases] } : emptyRule()
    this.previewImage = rule?.imageUrl || ''
    this.sourceName = ''
    this.upload = null
    this.preview = null
    this.previewVersion = (this.previewVersion || 0) + 1
    this.error = ''
    this.notice = ''
  }
  chooseName(entry) {
    this.change({ keyword: entry.name, scope: entry.scope })
  }
  async chooseUpload(event) {
    const file = event.currentTarget.files[0]
    event.currentTarget.value = ''
    if (!file) return
    this.error = ''
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      this.error = 'Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.'
      return
    }
    this.releasePreview()
    this.upload = file
    this.sourceName = ''
    this.previewImage = URL.createObjectURL(file)
  }
  chooseFile(event) {
    this.releasePreview()
    this.upload = null
    this.sourceName = event.currentTarget.value
    this.previewImage = this.sourceName ? `${root}/files/preview?name=${encodeURIComponent(this.sourceName)}` : this.draft.imageUrl || ''
  }
  async checkMatches() {
    this.busy = true
    this.error = ''
    const version = this.previewVersion = (this.previewVersion || 0) + 1
    try {
      const preview = await apiRequest(`${root}/preview`, { method: 'POST', body: JSON.stringify(this.draft) })
      if (version === this.previewVersion) this.preview = preview
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  asAlias(rule, alias = this.draft.keyword) {
    this.edit(rule)
    this.change({ aliases: [...rule.aliases, alias] })
    this.notice = `Alias «${alias}» preparado para «${rule.keyword}». Revisa coincidencias y guarda para confirmarlo.`
  }
  async save(event) {
    event.preventDefault()
    if (!this.preview) { this.error = 'Revisa las coincidencias antes de guardar.'; return }
    this.busy = true
    this.error = ''
    try {
      let file = this.draft.file
      if (this.upload) {
        const result = await apiRequest(`${root}/upload`, { method: 'POST',
          headers: { 'Content-Type': this.upload.type }, body: this.upload })
        file = result.file
      } else if (this.sourceName) {
        file = (await apiRequest(`${root}/import`, { method: 'POST', body: JSON.stringify({ name: this.sourceName }) })).file
      }
      await apiRequest(this.draft.id ? `${root}/${this.draft.id}` : root, {
        method: this.draft.id ? 'PUT' : 'POST', body: JSON.stringify({ ...this.draft, file }),
      })
      invalidateCardImages()
      this.edit()
      this.data = await apiRequest(root)
      await this.loadFiles()
      this.notice = 'Regla guardada.'
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  async remove(rule) {
    if (!globalThis.confirm(`¿Eliminar la regla «${rule.keyword}» y sus alias? La imagen se conserva en la carpeta para reutilizarla.`)) return
    this.busy = true
    this.error = ''
    try {
      await apiRequest(`${root}/${rule.id}`, { method: 'DELETE' })
      invalidateCardImages()
      this.edit()
      this.data = await apiRequest(root)
      this.notice = 'Regla eliminada. No se modificaron cuentas ni movimientos.'
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  render() {
    const entries = (this.data?.names || []).filter((entry) => entry.name.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()))
    return html`
      <h1>Imágenes de tarjetas y cuentas</h1>
      <p>Solo nombres y tipos registrados. No se muestran saldos, cuentas ni titulares. Las reglas son compartidas por todos los usuarios.</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="success" role="status">${this.notice}</p>` : ''}
      ${this.busy ? html`<p role="status">Procesando…</p>` : ''}
      ${!this.allowed ? html`<button type="button" @click=${this.load} ?disabled=${this.busy}>Reintentar acceso</button>` : html`
        <div class="layout">
          <section><h2>Nombres registrados</h2>
            <label>Buscar nombre<input type="search" .value=${this.search} @input=${(event) => { this.search = event.target.value }} /></label>
            ${catalogScopes.filter(([scope]) => scope !== 'banco').map(([scope, label]) => {
              const rows = entries.filter((entry) => entry.scope === scope)
              return rows.length ? html`<h3>${label}</h3><ul>${rows.map((entry) => html`
                <li><strong>${entry.name}</strong><small>${entry.type} · ${entry.ruleId ? 'Con imagen asignada' : 'Pendiente de imagen'}</small>
                  <button type="button" ?disabled=${this.busy} @click=${() => this.chooseName(entry)}>Usar nombre</button>
                </li>`)}</ul>` : ''
            })}
            ${this.data && !entries.length ? html`<p>No hay nombres coincidentes.</p>` : ''}
          </section>
          <section><h2>${this.draft.id ? 'Editar regla' : 'Nueva regla'}</h2>
            <form class="form" @submit=${this.save}>
              <label>Palabra o frase completa<input maxlength="150" required .value=${this.draft.keyword}
                @input=${(event) => this.change({ keyword: event.target.value })} /></label>
              <label>Tipo<select .value=${this.draft.scope} @change=${(event) => this.change({ scope: event.target.value, kind: 'general' })}>
                ${catalogScopes.map(([scope, label]) => html`<option value=${scope} ?selected=${this.draft.scope === scope}>${label}</option>`)}
              </select></label>
              ${this.draft.scope === 'credito' ? html`<label>Prioridad<select .value=${this.draft.kind} @change=${(event) => this.change({ kind: event.target.value })}>
                <option value="general" ?selected=${this.draft.kind === 'general'}>General</option>
                <option value="producto" ?selected=${this.draft.kind === 'producto'}>Producto específico (ej. BBVA Vive)</option>
              </select></label>` : ''}
              <label>Alias confirmados (uno por línea)<textarea rows="3" .value=${this.draft.aliases.join('\n')}
                @input=${(event) => this.change({ aliases: event.target.value.split('\n').filter((alias) => alias.trim()) })}></textarea></label>
              <label>Subir imagen nueva (JPG, PNG o WebP; máximo 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp"
                @change=${this.chooseUpload} ?disabled=${this.busy} /></label>
              ${this.storageError ? html`<p class="error" role="alert">${this.storageError}</p>` : ''}
              <label>O elegir archivo existente<select .value=${this.sourceName} @change=${this.chooseFile} ?disabled=${this.busy}>
                <option value="">Conservar imagen / seleccionar archivo</option>
                ${this.files.map((file) => html`<option value=${file}>${file}</option>`)}
              </select></label>
              <button type="button" @click=${this.loadFiles} ?disabled=${this.busy}>Actualizar carpeta</button>
              ${this.previewImage ? html`<img src=${this.previewImage} alt="Vista previa de imagen"
                @error=${() => { this.error = 'No se pudo mostrar la imagen. Revisa el archivo, el montaje y sus permisos.' }} />` : ''}
              <div class="actions"><button type="button" @click=${this.checkMatches} ?disabled=${this.busy || !this.draft.keyword.trim()}>Revisar coincidencias</button>
                <button type="submit" ?disabled=${this.busy || !this.preview}>Guardar regla</button>
                <button type="button" @click=${() => this.edit()} ?disabled=${this.busy}>Nueva / cancelar</button></div>
            </form>
            ${this.preview ? html`
              <h3>Coincidencias antes de guardar</h3>
              <ul>${this.preview.matches.map((entry) => html`<li>${entry.name}<small>${entry.type} · ${entry.selected ? 'Usará esta imagen' : 'Tiene otra regla con mayor prioridad'}</small></li>`)}</ul>
              ${!this.preview.matches.length ? html`<p>No coincide con nombres registrados actualmente.</p>` : ''}
              ${this.preview.similar.length ? html`<div class="warning"><strong>Reglas iguales o parecidas: revisa antes de crear otra.</strong>
                ${this.preview.similar.map((rule) => html`<p>${rule.keyword}
                  <button type="button" @click=${() => this.asAlias(rule)}>Asociar como alias de esta regla</button></p>`)}</div>` : ''}
              ${this.preview.suggestions.map((suggestion) => html`<p>Posible alias «${suggestion.alias}» en ${suggestion.name} (${suggestion.type}).
                <button type="button" @click=${() => this.change({ aliases: [...this.draft.aliases, suggestion.alias] })}>Confirmar alias en borrador</button></p>`)}
            ` : ''}
          </section>
        </div>
        <section><h2>Reglas del catálogo</h2>
          <ul>${(this.data?.rules || []).map((rule) => html`<li class="rule">
            <img src=${rule.imageUrl} alt="" @error=${(event) => { event.target.hidden = true }} />
            <span><strong>${rule.keyword}</strong><small>${rule.scope} · ${rule.kind} · Alias: ${rule.aliases.join(', ') || 'Ninguno'}</small></span>
            <button type="button" @click=${() => this.edit(rule)} ?disabled=${this.busy}>Editar</button>
            <button type="button" @click=${() => this.remove(rule)} ?disabled=${this.busy}>Eliminar</button>
          </li>`)}</ul>
          ${!this.data?.rules.length ? html`<p>No hay reglas guardadas.</p>` : ''}
          <h3>Posibles alias en nombres registrados</h3>
          ${(this.data?.suggestions || []).map((suggestion) => html`<p>«${suggestion.alias}» podría ser «${suggestion.keyword}» · ${suggestion.name} (${suggestion.type})
            <button type="button" ?disabled=${this.busy} @click=${() => this.asAlias(this.data.rules.find((rule) => rule.id === suggestion.ruleId), suggestion.alias)}>Revisar como alias</button></p>`)}
        </section>
      `}
    `
  }
}
customElements.define('card-catalog-admin', CardCatalogAdmin)
