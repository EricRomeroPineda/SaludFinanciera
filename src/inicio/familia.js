import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import styles from './styles.css?inline'

class FamilySettings extends LitElement {
  static styles = [unsafeCSS(styles), unsafeCSS(`
    :host { display: block; margin-top: 24px; }
    .family-actions { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; }
    .members { padding-left: 20px; }
    .members li { margin: 12px 0; }
    .invitation { overflow-wrap: anywhere; user-select: all; }
    .danger { color: var(--negative); }
  `)]
  static properties = {
    family: { state: true }, loading: { state: true }, busy: { state: true },
    error: { state: true }, notice: { state: true }, code: { state: true }, ready: { state: true },
  }

  constructor() {
    super()
    this.family = null
    this.loading = true
    this.busy = false
    this.error = ''
    this.notice = ''
    this.code = ''
    this.ready = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.load()
  }

  async load() {
    this.loading = true
    this.ready = false
    this.error = ''
    try {
      const { family } = await apiRequest('/api/family')
      this.family = family
      this.ready = true
    } catch (error) {
      this.error = error.message
    } finally {
      this.loading = false
    }
  }

  async perform(path, method, body, notice) {
    this.busy = true
    this.error = ''
    this.notice = ''
    this.code = ''
    try {
      const result = await apiRequest(`/api/family${path}`, {
        method, ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (result.code) this.code = result.code
      this.notice = notice
      await this.load()
    } catch (error) {
      this.error = error.message
    } finally {
      this.busy = false
    }
  }

  submit(event, path, method, field, notice) {
    event.preventDefault()
    this.perform(path, method, { [field]: new FormData(event.currentTarget).get(field) }, notice)
  }

  render() {
    const family = this.family
    return html`
      <section class="data-card">
        <div class="section-heading"><h2>Mi familia</h2></div>
        <p>La vista individual se conserva. Al unirte, todos los integrantes podrán consultar sus datos financieros
          en conjunto, sin modificar los registros de los demás. No se comparten contraseñas ni datos de recuperación.</p>
        ${this.loading ? html`<p role="status">Cargando familia…</p>` : ''}
        ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>
          <button class="quiet-button" ?disabled=${this.busy} @click=${this.load}>Reintentar</button>` : ''}
        ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
        ${!this.loading && !family && this.ready ? html`
          <form class="auth-form" @submit=${(event) => this.submit(event, '', 'POST', 'name', 'Familia creada. Genera un código para invitar a tu pareja.')}>
            <label>Nombre de la familia<input name="name" maxlength="100" required /></label>
            <button class="primary-button" ?disabled=${this.busy}>Crear familia</button>
          </form>
          <h3>Aceptar una invitación</h3>
          <form class="auth-form" @submit=${(event) => this.submit(event, '/join', 'POST', 'code', 'Te uniste a la familia. Ya pueden consultar la vista familiar.')}>
            <label>Código de invitación<input name="code" minlength="43" maxlength="43" autocomplete="off" required /></label>
            <label><span><input type="checkbox" required /> Acepto compartir la consulta de mis finanzas con los integrantes de esta familia.</span></label>
            <button class="primary-button" ?disabled=${this.busy}>Aceptar y unirme</button>
          </form>
        ` : ''}
        ${!this.loading && family ? html`
          <h3>${family.name}</h3>
          <ul class="members">${family.members.map((member) => html`
            <li>${member.name}${Number(member.id) === Number(family.creatorId) ? ' · Creador/a' : ''}
              ${family.isOwner && Number(member.id) !== Number(family.creatorId) ? html`
                <button class="text-button danger" ?disabled=${this.busy} @click=${() => {
                  if (window.confirm(`¿Retirar a ${member.name}? Se dejarán de compartir sus datos; no se borrará su información.`)) {
                    this.perform(`/members/${member.id}`, 'DELETE', null, 'Integrante retirado.')
                  }
                }}>Retirar integrante</button>
              ` : ''}
            </li>
          `)}</ul>
          ${family.isOwner ? html`
            <form class="auth-form" @submit=${(event) => this.submit(event, '', 'PUT', 'name', 'Nombre de familia actualizado.')}>
              <label>Nombre de la familia<input name="name" maxlength="100" .value=${family.name} required /></label>
              <button class="primary-button" ?disabled=${this.busy}>Guardar nombre</button>
            </form>
            <div class="family-actions">
              <button class="quiet-button" ?disabled=${this.busy} @click=${() => this.perform(
                '/invitations', 'POST', null, 'Código de un solo uso, válido por 24 horas. Generar otro invalida el anterior.',
              )}>Generar código de invitación</button>
              <button class="text-button danger" ?disabled=${this.busy} @click=${() => {
                if (window.confirm('¿Disolver la familia? Todos perderán la consulta conjunta. Ningún dato financiero será borrado.')) {
                  this.perform('', 'DELETE', null, 'Familia disuelta; cada usuario conserva sus datos.')
                }
              }}>Disolver familia</button>
            </div>
          ` : html`
            <button class="quiet-button" ?disabled=${this.busy} @click=${() => {
              if (window.confirm('¿Salir de la familia y dejar de compartir la consulta de tus finanzas?')) {
                this.perform('/membership', 'DELETE', null, 'Saliste de la familia. Tus datos permanecen intactos.')
              }
            }}>Salir de la familia</button>
          `}
          ${this.code ? html`<p>Comparte este código únicamente con la persona que quieras invitar:</p>
            <p class="invitation"><code>${this.code}</code></p>` : ''}
          <p>En Salud financiera selecciona <strong>Vista → Familiar</strong> para consultar los datos conjuntos.</p>
        ` : ''}
      </section>
    `
  }
}

customElements.define('family-settings', FamilySettings)
