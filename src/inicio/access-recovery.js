import { LitElement, html, svg, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import styles from './styles.css?inline'
import './email-settings.js'

class AccessRecovery extends LitElement {
  static styles = [unsafeCSS(styles)]
  static properties = {
    busy: { state: true }, error: { state: true }, notice: { state: true },
    token: { state: true }, resendSeconds: { state: true },
    email: { state: true }, verifiedEmail: { state: true }, useKey: { state: true },
    selectedMethod: { state: true },
  }

  constructor() {
    super()
    this.busy = false
    this.error = ''
    this.notice = ''
    this.token = ''
    this.email = ''
    this.verifiedEmail = ''
    this.useKey = false
    this.selectedMethod = ''
    this.resendSeconds = 0
    this.generation = 0
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearInterval(this.clock)
    this.generation++
    this.token = ''
    this.verifiedEmail = ''
    this.useKey = false
  }

  countdown() {
    clearInterval(this.clock)
    this.resendSeconds = 30
    this.clock = setInterval(() => {
      this.resendSeconds = Math.max(0, this.resendSeconds - 1)
      if (!this.resendSeconds) clearInterval(this.clock)
    }, 1000)
  }

  editEmail() {
    this.generation++
    this.busy = false
    this.verifiedEmail = ''
    this.token = ''
    this.useKey = false
    this.selectedMethod = ''
    this.error = ''
    this.notice = ''
    this.updateComplete.then(() => this.renderRoot.querySelector('[name="email"]')?.focus())
  }

  changeEmail(event) {
    this.email = event.target.value
    this.editEmail()
  }

  async checkEmail(event) {
    event.preventDefault()
    if (this.busy) return
    const form = event.currentTarget
    if (!form.reportValidity()) return
    const email = form.querySelector('[name="email"]').value.trim().toLowerCase()
    const generation = this.generation
    this.error = ''
    this.notice = ''
    this.busy = true
    try {
      const result = await apiRequest('/api/auth/email/check-recovery-email', {
        method: 'POST', body: JSON.stringify({ email }),
      })
      if (generation !== this.generation) return
      this.email = result.email
      this.verifiedEmail = result.email
      this.useKey = true
      this.selectedMethod = 'key'
    } catch (error) {
      if (generation === this.generation) this.error = error.message
    } finally {
      if (generation === this.generation) this.busy = false
    }
  }

  selectMethod(method) {
    if (this.busy) return
    this.selectedMethod = method
    this.useKey = method === 'key'
    this.error = ''
    this.notice = ''
  }

  async submit(event, purpose) {
    event.preventDefault()
    if (this.busy || !this.verifiedEmail || this.email !== this.verifiedEmail || (purpose && this.resendSeconds)) return
    if (!purpose && !this.useKey) return
    const form = event.currentTarget
    if (!purpose && !form.reportValidity()) return
    const generation = this.generation
    this.error = ''
    this.notice = ''
    this.busy = true
    try {
      const data = new FormData(form)
      const result = await apiRequest(`/api/auth/email/${purpose ? 'request-access-link' : 'validate-recovery-key'}`, {
        method: 'POST', body: JSON.stringify(purpose
          ? { email: this.verifiedEmail, purpose }
          : { email: this.verifiedEmail, recoveryKey: data.get('accessRecoveryKey') }),
      })
      if (generation !== this.generation) return
      if (purpose) {
        this.notice = result.message
        this.countdown()
      } else {
        this.token = result.token
        form.reset()
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.error = error.message
      if (purpose && error.status === 429) this.countdown()
    } finally {
      if (generation === this.generation) this.busy = false
    }
  }

  icon(kind) {
    const paths = {
      check: svg`<path d="m5 12 4 4L19 6" />`,
      edit: svg`<path d="m16 3 5 5L8 21H3v-5L16 3Z M13 6l5 5" />`,
      mail: svg`<rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" />`,
      key: svg`<circle cx="8" cy="9" r="5" /><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3" />`,
      resetKey: svg`<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /><circle cx="12" cy="11" r="2" /><path d="M12 13v5" />`,
    }
    return html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" aria-hidden="true">${paths[kind]}</svg>`
  }

  render() {
    if (this.token) return html`
      <p>Correo y palabra clave validados. Define tu nueva contraseña; este permiso caduca en 10 minutos.</p>
      <email-settings .purpose=${'reset-password'} .token=${this.token}></email-settings>
      <button class="quiet-button" type="button" @click=${this.editEmail}>Cambiar correo o volver a validar</button>`
    return html`
      <p>Valida primero tu correo registrado y verificado para elegir cómo recuperar el acceso.</p>
      ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
      <form class="auth-form" @submit=${this.checkEmail}>
        <label>Correo electrónico
          <div class="recovery-email">
            <input name="email" type="email" maxlength="254" autocomplete="email" required
              .value=${this.email} ?disabled=${this.busy || Boolean(this.verifiedEmail)} @input=${this.changeEmail} />
            ${this.verifiedEmail ? html`<button class="quiet-button recovery-icon" type="button" aria-label="Editar correo" title="Editar correo"
              ?disabled=${this.busy} @click=${this.editEmail}>${this.icon('edit')}</button>`
              : html`<button class="primary-button recovery-icon" type="submit" aria-label="Validar correo" title="Validar correo"
                ?disabled=${this.busy}>${this.icon('check')}</button>`}
          </div>
        </label>
      </form>
      ${this.verifiedEmail ? html`
        <p class="success-message" role="status">Correo validado.</p>
        <form class="auth-form recovery-options" autocomplete="off"
          @submit=${(event) => this.submit(event, this.useKey ? undefined : this.selectedMethod)}>
          <div class="recovery-actions">
            <div class="recovery-action">
              <button class="quiet-button recovery-icon" type="button" aria-label="Recuperar contraseña con palabra clave"
                title="Recuperar contraseña con palabra clave" aria-pressed=${String(this.useKey)} ?disabled=${this.busy}
                @click=${() => this.selectMethod('key')}>${this.icon('key')}</button>
            </div>
            <div class="recovery-action">
              <button class="quiet-button recovery-icon" type="button"
                @click=${() => this.selectMethod('reset-password')} aria-pressed=${String(this.selectedMethod === 'reset-password')}
                aria-label="Recuperar contraseña por correo" title="Recuperar contraseña por correo"
                ?disabled=${this.busy}>${this.icon('mail')}</button>
            </div>
            <div class="recovery-action">
              <button class="quiet-button recovery-icon" type="button"
                @click=${() => this.selectMethod('reset-recovery')} aria-pressed=${String(this.selectedMethod === 'reset-recovery')}
                aria-label="Recuperar palabra clave por correo" title="Recuperar palabra clave por correo"
                ?disabled=${this.busy}>${this.icon('resetKey')}</button>
            </div>
            <p aria-live="polite">${this.selectedMethod === 'reset-password'
              ? 'Recuperar contraseña por correo: recibirás un enlace para elegir una contraseña nueva. No necesitas la palabra clave. El enlace caduca en 30 minutos.'
              : this.selectedMethod === 'reset-recovery'
                ? 'Recuperar palabra clave por correo: recibirás un enlace para elegir una palabra clave nueva. Tu contraseña de acceso no cambia. El enlace caduca en 30 minutos.'
                : this.useKey
                  ? 'Recuperar contraseña con palabra clave: escríbela para validarla y mostrar el cambio de contraseña.'
                  : 'Selecciona un icono para elegir cómo recuperar tu acceso.'}</p>
            ${['reset-password', 'reset-recovery'].includes(this.selectedMethod) ? html`
              <button class="primary-button" type="submit" ?disabled=${this.busy || this.resendSeconds > 0}>
                ${this.busy ? 'Enviando…' : this.selectedMethod === 'reset-password'
                  ? 'Enviar enlace de contraseña al correo' : 'Enviar enlace de palabra clave al correo'}
              </button>` : ''}
          </div>
          ${this.resendSeconds > 0 ? html`<p role="status">Espera ${this.resendSeconds} segundos para solicitar otro correo.</p>` : ''}
          ${this.useKey ? html`<label>Palabra clave de recuperación
            <div class="recovery-email">
              <input name="accessRecoveryKey" type="password" minlength="4" maxlength="72" autocomplete="new-password"
                .value=${''} required ?disabled=${this.busy} />
              <button class="primary-button recovery-icon" type="submit" value="" aria-label="Validar palabra clave"
                title="Validar palabra clave" ?disabled=${this.busy}>${this.icon('check')}</button>
            </div>
          </label>` : ''}
        </form>` : ''}
    `
  }
}

customElements.define('access-recovery', AccessRecovery)
