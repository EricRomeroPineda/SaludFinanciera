import { LitElement, html, css } from 'lit'
import { apiRequest } from '../../src/api.js'
import { loadGoogleIdentity, prepareGoogleReminders, requestGoogleAccess, syncGoogleReminder } from './google-calendar-client.js'

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const monthFormat = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })

class GoogleCalendarSync extends LitElement {
  static properties = {
    month: { type: String }, familyView: { type: Boolean }, disabled: { type: Boolean },
    revision: { attribute: false }, loading: { state: true }, busy: { state: true },
    error: { state: true }, notice: { state: true }, config: { state: true },
    events: { state: true }, selected: { state: true }, results: { state: true },
    ready: { state: true }, consent: { state: true }, time: { state: true },
  }
  static styles = css`
    :host { display: block; margin: 0 0 16px; }
    * { box-sizing: border-box; }
    button, input { font: inherit; }
    button { padding: 9px 13px; border: 1px solid var(--line); border-radius: 8px;
      color: var(--ink); background: var(--surface); cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
    dialog { width: min(760px, calc(100vw - 24px)); max-height: 85vh; overflow: auto;
      margin: auto; padding: 20px; border: 1px solid var(--line); border-radius: 12px;
      color: var(--ink); background: var(--surface); font-size: 13px; }
    dialog::backdrop { background: rgb(0 0 0 / .5); }
    header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    h2 { margin: 0; font-size: 18px; }
    p { line-height: 1.6; overflow-wrap: anywhere; }
    .list { margin: 12px 0; padding: 0; list-style: none; }
    .list li { padding: 12px 0; border-top: 1px solid var(--line); }
    label { display: flex; align-items: start; gap: 8px; line-height: 1.5; }
    input[type="checkbox"] { flex: 0 0 auto; margin-top: 4px; }
    small { display: block; color: var(--muted); line-height: 1.6; }
    .details { min-width: 0; overflow-wrap: anywhere; }
    .error { color: var(--negative); }
    .notice { color: var(--positive); }
    .consent { margin: 16px 0; }
    .time { align-items: center; flex-wrap: wrap; }
    input[type="time"] { padding: 6px; border: 1px solid var(--line); border-radius: 6px;
      color: var(--ink); background: var(--surface); }
    code { overflow-wrap: anywhere; }
  `

  constructor() {
    super()
    this.events = []
    this.selected = new Set()
    this.results = {}
    this.time = '09:00'
    this.error = ''
    this.notice = ''
    this.loading = false
    this.busy = false
    this.ready = false
    this.consent = false
    this.version = 0
  }

  updated(changed) {
    if (changed.has('month') || changed.has('familyView') || changed.has('revision')) this.reset()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.reset()
  }

  reset() {
    this.version++
    this.controller?.abort()
    this.renderRoot.querySelector('dialog')?.close()
    this.events = []
    this.selected = new Set()
    this.results = {}
    this.config = null
    this.ready = false
    this.consent = false
    this.loading = false
    this.busy = false
  }

  close() {
    if (!this.busy) this.reset()
  }

  async open() {
    if (this.familyView || this.disabled) return
    this.reset()
    const version = this.version
    const month = this.month
    this.previewMonth = month
    this.loading = true
    this.error = ''
    this.notice = ''
    this.renderRoot.querySelector('dialog').showModal()
    try {
      const config = await apiRequest('/api/calendar/google-config')
      if (version !== this.version) return
      this.config = config
      if (!config.configured) return
      const data = await apiRequest(`/api/calendar?month=${encodeURIComponent(month)}&scope=month`)
      if (version !== this.version) return
      this.events = prepareGoogleReminders(month, data.events)
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      this.selected = new Set(this.events.filter((event) => !event.reference && event.date >= today).map((event) => event.key))
      if (this.events.some((event) => !event.reference)) {
        await loadGoogleIdentity()
        if (version === this.version) this.ready = true
      }
    } catch (error) {
      if (version === this.version) this.error = error.message
    } finally {
      if (version === this.version) this.loading = false
    }
  }

  select(event, checked) {
    const selected = new Set(this.selected)
    if (checked) selected.add(event.key)
    else selected.delete(event.key)
    this.selected = selected
  }

  async sync() {
    if (this.busy || !this.ready || !this.consent || !this.selected.size || this.familyView) return
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.time)) {
      this.error = 'Selecciona una hora válida para el recordatorio.'
      return
    }
    this.busy = true
    this.error = ''
    this.notice = ''
    this.controller = new AbortController()
    const { signal } = this.controller
    const chosen = this.events.filter((event) => this.selected.has(event.key) && !event.reference)
    const version = this.version
    let completed = 0
    let token
    try {
      // Keep this call directly in the click handler so the browser allows Google's popup.
      token = await requestGoogleAccess(this.config.clientId)
      for (const event of chosen) {
        if (signal.aborted || version !== this.version) return
        try {
          const status = await syncGoogleReminder(token, this.config.namespace, event, this.time, signal)
          if (version !== this.version) return
          this.results = { ...this.results, [event.key]: { status } }
          this.selected = new Set([...this.selected].filter((key) => key !== event.key))
          completed++
        } catch (error) {
          if (signal.aborted || version !== this.version) return
          this.results = { ...this.results, [event.key]: { status: 'error', message: error.message } }
          if ([401, 403, 429].includes(error.status)) {
            this.error = error.message
            break
          }
        }
      }
      if (completed) this.notice = `${completed} recordatorio(s) guardado(s) en tu calendario principal de Google.`
      if (this.selected.size) this.error ||= 'Quedaron recordatorios pendientes. Revisa los errores y vuelve a autorizar para reintentar sin duplicarlos.'
    } catch (error) {
      if (version === this.version) this.error = error.message
    } finally {
      token = null
      if (version === this.version) this.busy = false
    }
  }

  render() {
    const month = this.previewMonth || this.month
    const title = /^\d{4}-\d{2}$/.test(month || '') ? monthFormat.format(new Date(`${month}-01T12:00:00Z`)) : ''
    return html`
      <button type="button" ?disabled=${this.disabled || this.familyView || this.busy} @click=${this.open}>
        Sincronizar con Google Calendar
      </button>
      ${this.familyView ? html`<small>La sincronización está disponible en la vista Individual.</small>` : ''}
      <dialog aria-labelledby="google-calendar-title" @cancel=${(event) => { event.preventDefault(); this.close() }}>
        <header><h2 id="google-calendar-title">Recordatorios · ${title}</h2>
          <button type="button" ?disabled=${this.busy} @click=${this.close}>Cerrar</button></header>
        ${this.loading ? html`<p role="status">Preparando vista previa…</p>` : ''}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        ${this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : ''}
        ${this.config?.configured === false ? html`
          <p>Primero configura Google Calendar: habilita Calendar API y crea un cliente OAuth de tipo Aplicación web
            en Google Cloud. Agrega <code>GOOGLE_CALENDAR_CLIENT_ID</code> al archivo <code>.env</code> y reinicia Node.
            La guía está en el README del proyecto. No se necesita SQL ni el secreto del cliente.</p>
        ` : ''}
        ${this.config?.configured && !this.loading ? html`
          <p>Se enviarán únicamente los marcadores seleccionados: nombre, tipo, fecha y monto.
            No se enviarán movimientos registrados ni imágenes. Elige tu cuenta Google en la ventana de autorización.</p>
          <p>Se crearán eventos privados de 15 minutos en tu calendario principal, con avisos
            <strong>un día antes y el mismo día</strong>, a la hora indicada.</p>
          <label class="time">Hora del compromiso
            <input aria-label="Hora del compromiso" type="time" .value=${this.time} ?disabled=${this.busy}
              @input=${(event) => { this.time = event.currentTarget.value }} />
            <small>Zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          </label>
          <p>Los avisos de fechas u horas ya pasadas no se envían retroactivamente.
            Las suscripciones sin fecha exacta de inicio están excluidas.</p>
          ${this.events.length ? html`
            <ul class="list">${this.events.map((event) => html`
              <li><label><input type="checkbox" .checked=${this.selected.has(event.key)}
                ?disabled=${this.busy || event.reference}
                @change=${(change) => this.select(event, change.currentTarget.checked)} />
                <span class="details"><strong>${event.label}</strong>
                  <small>${event.date} · ${event.typeLabel} · ${event.amount == null ? 'Monto por definir' : currency.format(Number(event.amount))}</small>
                  ${event.reference ? html`<small>Solo referencia: configura el inicio de la suscripción para enviarla.</small>` : ''}
                  ${this.results[event.key] ? html`<small class=${this.results[event.key].status === 'error' ? 'error' : 'notice'}>
                    ${this.results[event.key].status === 'created' ? 'Creado' : this.results[event.key].status === 'updated' ? 'Actualizado' : this.results[event.key].message}
                  </small>` : ''}
                </span></label></li>
            `)}</ul>
          ` : html`<p>No hay marcadores previstos para este mes.</p>`}
          <p>Volver a enviar actualiza los eventos de esta aplicación, sin duplicarlos.
            No se eliminan eventos: si liquidas una deuda, cancelas una suscripción o cambia el número de aportaciones,
            revisa y elimina en Google los recordatorios que ya no correspondan.</p>
          <label class="consent"><input type="checkbox" .checked=${this.consent} ?disabled=${this.busy}
            @change=${(event) => { this.consent = event.currentTarget.checked }} />
            Autorizo enviar estos datos financieros a Google Calendar.
          </label>
          <div class="actions">
            <small>No se guardan contraseñas ni tokens. Cada envío pide autorización.</small>
            <button type="button" ?disabled=${this.busy || !this.ready || !this.consent || !this.selected.size} @click=${this.sync}>
              ${this.busy ? 'Sincronizando…' : `Autorizar y enviar ${this.selected.size} recordatorio(s)`}
            </button>
          </div>
        ` : ''}
        ${this.error && !this.busy && !this.ready ? html`<button type="button" @click=${this.open}>Reintentar vista previa</button>` : ''}
      </dialog>
    `
  }
}

customElements.define('google-calendar-sync', GoogleCalendarSync)
