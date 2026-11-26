import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import styles from './styles.css?inline'

class EmailSettings extends LitElement {
  static styles = [unsafeCSS(styles)]
  static properties = {
    user: { attribute: false }, purpose: { attribute: false }, token: { attribute: false },
    busy: { state: true }, error: { state: true }, notice: { state: true }, done: { state: true },
    showPassword: { state: true }, showKey: { state: true },
  }

  constructor() {
    super()
    this.busy = false
    this.error = ''
    this.notice = ''
    this.done = false
    this.showPassword = false
    this.showKey = false
  }

  async perform(path, body) {
    if (this.busy) return
    this.busy = true
    this.error = ''
    this.notice = ''
    let saved = false
    try {
      const result = await apiRequest(`/api/auth/email/${path}`, { method: 'POST', body: JSON.stringify(body) })
      saved = true
      const password = this.renderRoot?.querySelector('[name="currentPassword"]')
      if (password) password.value = ''
      if (path === 'verify' || path === 'reset-recovery') {
        this.done = true
        this.token = ''
        this.notice = path === 'verify' ? 'Correo verificado. Ya puedes usarlo desde Mi perfil.'
          : 'Palabra clave de recuperación actualizada. Ya puedes usarla para recuperar tu contraseña.'
      } else {
        this.notice = result.message
      }
      if (this.user) {
        this.user = (await apiRequest('/api/auth/me')).user
        this.dispatchEvent(new CustomEvent('email-updated', { detail: this.user, bubbles: true, composed: true }))
      }
    } catch (error) {
      this.error = saved ? `La operación se completó, pero no se pudo actualizar el perfil: ${error.message}` : error.message
    } finally {
      this.busy = false
    }
  }

  eye(key) {
    const show = key ? this.showKey : this.showPassword
    const label = `${show ? 'Ocultar' : 'Mostrar'} ${key ? 'nueva palabra clave' : 'contraseña escrita'}`
    return html`<button class="quiet-button" type="button" aria-label=${label} title=${label}
      aria-pressed=${String(show)} @click=${() => { if (key) this.showKey = !show; else this.showPassword = !show }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
      </svg></button>`
  }

  render() {
    return html`<section class="data-card email-settings">
      <h2>${this.purpose ? 'Enlace de correo' : 'Correo electrónico y recuperación'}</h2>
      ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
      ${this.purpose ? this.done ? '' : html`
        <p>Enlace temporal de un solo uso. La palabra clave anterior nunca se muestra.</p>
        <form class="auth-form" @submit=${(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          this.perform(this.purpose === 'verify-email' ? 'verify' : 'reset-recovery', {
            token: this.token, recoveryKey: data.get('recoveryKey'),
          })
        }}>
          ${this.purpose === 'reset-recovery' ? html`<label>Nueva palabra clave de recuperación
            <div class="secret-field"><input name="recoveryKey" type=${this.showKey ? 'text' : 'password'}
              minlength="4" maxlength="72" autocomplete="off" required />${this.eye(true)}</div></label>` : ''}
          <button class="primary-button" ?disabled=${this.busy}>${this.busy ? 'Procesando…' : this.purpose === 'verify-email' ? 'Verificar mi correo' : 'Guardar nueva palabra clave'}</button>
        </form>
      ` : html`
        <p>${this.user?.email || 'No tienes un correo registrado.'}
          ${this.user?.email ? Number(this.user.emailVerified) ? ' · Verificado' : ' · Pendiente de verificación' : ''}</p>
        <form class="auth-form" @submit=${(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          this.perform('send-verification', { email: data.get('email'), currentPassword: data.get('currentPassword') })
        }}>
          <label>Correo electrónico<input name="email" type="email" maxlength="254" autocomplete="email"
            .value=${this.user?.email || ''} required ?disabled=${this.busy} /></label>
          <label>Contraseña actual para registrar o cambiar el correo
            <div class="secret-field"><input name="currentPassword" type=${this.showPassword ? 'text' : 'password'}
              autocomplete="current-password" required ?disabled=${this.busy} />${this.eye(false)}</div></label>
          <button class="primary-button" ?disabled=${this.busy}>Enviar verificación al correo</button>
        </form>
        <p>Cambiar el correo requiere verificar la nueva dirección. Cada nuevo envío invalida el enlace anterior.</p>
        <button class="quiet-button" type="button" ?disabled=${this.busy || !Number(this.user?.emailVerified)}
          @click=${() => this.perform('send-recovery', {})}>Enviar enlace para cambiar mi palabra clave</button>
        <p>No podemos mostrar ni enviar tu contraseña ni tu palabra clave actuales: se almacenan como hashes.</p>
      `}
      ${this.purpose ? html`<p><a href="/">Volver a Salud Financiera</a></p>` : ''}
    </section>`
  }
}

customElements.define('email-settings', EmailSettings)
