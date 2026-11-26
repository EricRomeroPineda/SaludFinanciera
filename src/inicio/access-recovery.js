import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import styles from './styles.css?inline'
import './email-settings.js'

class AccessRecovery extends LitElement {
  static styles = [unsafeCSS(styles)]
  static properties = {
    busy: { state: true }, error: { state: true }, notice: { state: true },
    token: { state: true }, resendSeconds: { state: true },
  }

  constructor() {
    super()
    this.busy = false
    this.error = ''
    this.notice = ''
    this.token = ''
    this.resendSeconds = 0
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearInterval(this.clock)
    this.token = ''
  }

  countdown() {
    clearInterval(this.clock)
    this.resendSeconds = 30
    this.clock = setInterval(() => {
      this.resendSeconds = Math.max(0, this.resendSeconds - 1)
      if (!this.resendSeconds) clearInterval(this.clock)
    }, 1000)
  }

  async submit(event, purpose) {
    event.preventDefault()
    if (this.busy || (purpose && this.resendSeconds)) return
    const form = event.currentTarget
    const email = form.querySelector('[name="email"]')
    if (!email.reportValidity()) return
    if (!purpose && !form.reportValidity()) return
    this.error = ''
    this.notice = ''
    this.busy = true
    try {
      const data = new FormData(form)
      const result = await apiRequest(`/api/auth/email/${purpose ? 'request-access-link' : 'validate-recovery-key'}`, {
        method: 'POST', body: JSON.stringify(purpose
          ? { email: data.get('email'), purpose }
          : { email: data.get('email'), recoveryKey: data.get('recoveryKey') }),
      })
      if (purpose) {
        this.notice = result.message
        this.countdown()
      } else {
        this.token = result.token
        form.reset()
      }
    } catch (error) {
      this.error = error.message
      if (purpose && error.status === 429) this.countdown()
    } finally {
      this.busy = false
    }
  }

  render() {
    if (this.token) return html`
      <p>Correo y palabra clave validados. Define tu nueva contraseña; este permiso caduca en 10 minutos.</p>
      <email-settings .purpose=${'reset-password'} .token=${this.token}></email-settings>
      <button class="quiet-button" type="button" @click=${() => { this.token = ''; this.error = ''; this.notice = '' }}>Volver a validar</button>`
    return html`
      <p>Escribe tu correo verificado y tu palabra clave. Después de validarlos aparecerá el cambio de contraseña.</p>
      ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
      <form class="auth-form" @submit=${(event) => this.submit(event, event.submitter?.value)}>
        <label>Correo electrónico
          <input name="email" type="email" maxlength="254" autocomplete="email" required ?disabled=${this.busy} /></label>
        <label>Palabra clave de recuperación
          <input name="recoveryKey" type="password" minlength="4" maxlength="72" autocomplete="off" required ?disabled=${this.busy} /></label>
        <button class="primary-button" type="submit" ?disabled=${this.busy}>${this.busy ? 'Procesando…' : 'Validar correo y palabra clave'}</button>
        <p>Si olvidaste tu contraseña o tu palabra clave, solicita un enlace al correo verificado.</p>
        ${this.resendSeconds > 0 ? html`<p role="status">Espera ${this.resendSeconds} segundos para solicitar otro correo.</p>` : ''}
        <button class="quiet-button" type="submit" value="reset-password" formnovalidate
          ?disabled=${this.busy || this.resendSeconds > 0}>Recuperar contraseña por correo</button>
        <button class="quiet-button" type="submit" value="reset-recovery" formnovalidate
          ?disabled=${this.busy || this.resendSeconds > 0}>Recuperar palabra clave por correo</button>
      </form>`
  }
}

customElements.define('access-recovery', AccessRecovery)
