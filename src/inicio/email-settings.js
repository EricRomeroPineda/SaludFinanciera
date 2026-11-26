import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import styles from './styles.css?inline'

class EmailSettings extends LitElement {
  static styles = [unsafeCSS(styles)]
  static properties = {
    user: { attribute: false }, purpose: { attribute: false }, token: { attribute: false },
    busy: { state: true }, error: { state: true }, notice: { state: true }, done: { state: true },
    showPassword: { state: true }, showKey: { state: true },
    resendSeconds: { state: true },
  }

  constructor() {
    super()
    this.busy = false
    this.error = ''
    this.notice = ''
    this.done = false
    this.showPassword = false
    this.showKey = false
    this.resendSeconds = 0
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearInterval(this.resendClock)
  }

  startResendCountdown(seconds = 30) {
    clearInterval(this.resendClock)
    this.resendSeconds = seconds
    this.resendClock = setInterval(() => {
      this.resendSeconds = Math.max(0, this.resendSeconds - 1)
      if (!this.resendSeconds) clearInterval(this.resendClock)
    }, 1000)
  }

  async perform(path, body) {
    if (this.busy) return
    if (path.startsWith('send-') && this.resendSeconds > 0) return
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
        this.startResendCountdown(result.retryAfterSeconds || 30)
      }
      if (this.user) {
        this.user = (await apiRequest('/api/auth/me')).user
        this.dispatchEvent(new CustomEvent('email-updated', { detail: this.user, bubbles: true, composed: true }))
      }
    } catch (error) {
      if (!saved && error.status === 429 && path.startsWith('send-')) this.startResendCountdown()
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
        <p>${this.user?.email || 'No tienes un correo registrado. Captura tu correo y verifícalo para habilitar la recuperación.'}
          ${this.user?.email ? Number(this.user.emailVerified) ? ' · Verificado' : ' · Pendiente de verificación' : ''}</p>
        ${Number(this.user?.emailVerified) ? html`<p>Tu correo está verificado y no se puede cambiar.</p>` : html`
        <form class="auth-form" @submit=${(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          this.perform('send-verification', { email: data.get('email'), currentPassword: data.get('currentPassword') })
        }}>
          <input name="username" type="text" autocomplete="section-profile-email username"
            .value=${this.user?.name || ''} hidden readonly />
          <label>Correo electrónico<input name="email" type="email" maxlength="254" autocomplete="section-profile-email email"
            placeholder="tu-correo@ejemplo.com"
            .value=${this.user?.email || ''} required ?disabled=${this.busy} /></label>
          <label>Escribe tu contraseña actual para registrar o verificar el correo
            <div class="secret-field"><input name="currentPassword" type=${this.showPassword ? 'text' : 'password'}
              autocomplete="section-profile-email current-password" required ?disabled=${this.busy} />${this.eye(false)}</div></label>
          <button class="primary-button" ?disabled=${this.busy || this.resendSeconds > 0}>Enviar verificación al correo</button>
        </form>
        <p>Verifica la dirección para registrarla definitivamente. Cada nuevo envío invalida el enlace anterior.</p>`}
        ${this.resendSeconds > 0 ? html`<p role="status">Espera ${this.resendSeconds} segundos para volver a enviar un correo.</p>` : ''}
        <button class="primary-button" type="button" ?disabled=${this.busy || this.resendSeconds > 0 || !this.user?.email || !Number(this.user?.emailVerified)}
          @click=${() => this.perform('send-key', {})}>Generar y enviarme una palabra clave</button>
        <p>Se enviará una nueva palabra clave a tu correo verificado y la anterior dejará de funcionar. Tu contraseña de acceso no cambia.</p>
        <button class="quiet-button" type="button" ?disabled=${this.busy || this.resendSeconds > 0 || !this.user?.email || !Number(this.user?.emailVerified)}
          @click=${() => this.perform('send-recovery', {})}>Enviar enlace para cambiar mi palabra clave</button>
        <p>Para elegir tu propia palabra clave, solicita el enlace de cambio. La clave actual y tu contraseña no se pueden consultar: se guardan como hashes.</p>
      `}
      ${this.purpose ? html`<p><a href="/">Volver a Salud Financiera</a></p>` : ''}
    </section>`
  }
}

customElements.define('email-settings', EmailSettings)
