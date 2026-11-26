import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import '../../saludFinanciera/frontend/salud-financiera.js'
import appearanceStyles from './appearance.css?inline'
import styles from './styles.css?inline'
import responsiveStyles from './responsive.css?inline'
import { isValidPhoto, themes } from '../../shared/profile.js'
import defaultAvatar from '../assets/default-avatar.svg'
import './familia.js'

class Inicio extends LitElement {
  static styles = [unsafeCSS(appearanceStyles), unsafeCSS(styles), unsafeCSS(responsiveStyles)]
  static properties = {
    user: { state: true },
    authMode: { state: true },
    activeTab: { state: true },
    activeSection: { state: true },
    loading: { state: true },
    submitting: { state: true },
    error: { state: true },
    photoDraft: { state: true },
    notice: { state: true },
    savingTheme: { state: true },
    brokenPhoto: { state: true },
    appearance: { state: true },
  }

  constructor() {
    super()
    this.user = null
    this.authMode = 'login'
    this.activeTab = 'overview'
    this.activeSection = 'menu'
    this.loading = true
    this.submitting = false
    this.error = ''
    this.photoDraft = ''
    this.notice = ''
    this.savingTheme = false
    this.brokenPhoto = false
    this.appearance = null
  }

  get effectiveAppearance() {
    return this.appearance || (this.user?.theme === 'oscuro' ? 'night' : 'day')
  }

  toggleAppearance() {
    this.appearance = this.effectiveAppearance === 'night' ? 'day' : 'night'
  }

  updated(changed) {
    if (changed.has('user') || changed.has('appearance')) {
      this.setAttribute('data-appearance', this.effectiveAppearance)
    }
    if (changed.has('user')) {
      const theme = themes.some(({ id }) => id === this.user?.theme) ? this.user.theme : 'verde'
      this.setAttribute('data-theme', theme)
      if (changed.get('user')?.photo !== this.user?.photo) this.brokenPhoto = false
    }
  }

  connectedCallback() {
    super.connectedCallback()
    this.restoreSession()
  }

  async restoreSession() {
    try {
      const { user } = await apiRequest('/api/auth/me')
      this.user = user
      this.activeSection = 'menu'
      this.appearance = null
    } catch (error) {
      if (error.status !== 401) this.error = error.message
    } finally {
      this.loading = false
    }
  }

  async handleAuthSubmit(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true

    const formData = new FormData(event.currentTarget)
    const recovering = this.authMode === 'recover'
    const route = `/api/auth/${recovering ? 'recover' : this.authMode}`
    const payload = {
      name: formData.get('name'),
      password: formData.get('password'),
    }
    if (this.authMode === 'register') payload.photo = String(formData.get('photoUrl') || '').trim()
    if (this.authMode !== 'login') payload.recoveryKey = formData.get('recoveryKey')

    try {
      const { user } = await apiRequest(route, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (recovering) {
        this.setAuthMode('login')
        this.notice = 'Contraseña restablecida. Inicia sesión con tu nueva contraseña.'
        return
      }
      this.user = user
      this.appearance = null
      this.photoDraft = user.photo || ''
      this.activeTab = 'overview'
      this.activeSection = 'menu'
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async handleLogout() {
    this.error = ''
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      this.user = null
      this.appearance = null
      this.authMode = 'login'
      this.activeSection = 'menu'
      this.photoDraft = ''
      this.notice = ''
    } catch (error) {
      this.error = error.message
    }
  }

  setAuthMode(mode) {
    this.authMode = mode
    this.error = ''
    this.notice = ''
    this.photoDraft = ''
    this.renderRoot.querySelector('.auth-form')?.reset()
  }

  handlePhotoUrl(event) {
    this.photoDraft = event.target.value.trim()
  }

  async handleThemeChange(event) {
    const select = event.currentTarget
    const theme = select.value
    this.error = ''
    this.notice = ''
    this.savingTheme = true
    try {
      const { user } = await apiRequest('/api/auth/theme', {
        method: 'PUT',
        body: JSON.stringify({ theme }),
      })
      this.user = user
      this.appearance = null
      this.notice = 'Tema guardado.'
    } catch (error) {
      this.error = error.message
      select.value = themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde'
    } finally {
      this.savingTheme = false
    }
  }

  async handleProfileSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    this.error = ''
    this.notice = ''
    this.submitting = true
    const formData = new FormData(form)
    try {
      const { user } = await apiRequest(`/api/users/${this.user.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          photo: String(formData.get('photoUrl') || '').trim(),
          theme: themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde',
          recoveryKey: formData.get('recoveryKey'),
          currentPassword: formData.get('currentPassword'),
        }),
      })
      this.user = user
      this.photoDraft = user.photo
      form.querySelector('[name="recoveryKey"]').value = ''
      form.querySelector('[name="currentPassword"]').value = ''
      this.notice = 'Perfil guardado.'
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  renderPhotoFields() {
    return html`
      <label>
        URL de tu foto de perfil
        <input name="photoUrl" type="url" placeholder="https://ejemplo.com/foto.jpg"
          .value=${this.photoDraft} maxlength="500" required
          ?disabled=${this.submitting} @input=${this.handlePhotoUrl} />
        <small>Usa una dirección HTTPS pública de hasta 500 caracteres.</small>
      </label>
      ${this.photoDraft && isValidPhoto(this.photoDraft) ? html`
        <img class="profile-photo preview-photo" src=${this.photoDraft} alt="Vista previa de tu foto"
          referrerpolicy="no-referrer" @error=${() => { this.error = 'No se pudo mostrar la foto. Revisa la URL o elige otra imagen.' }} />
      ` : ''}
    `
  }

  render() {
    if (this.loading) {
      return html`<main class="loading-screen"><span class="spinner"></span><p>Cargando Salud Financiera…</p></main>`
    }

    if (!this.user) return this.renderAuth()
    return this.activeSection === 'menu' ? this.renderMenu() : this.renderDashboard()
  }

  openFinancialSection(tab = 'overview') {
    this.activeSection = 'finance'
    this.activeTab = tab
    this.error = ''
    this.notice = ''
    if (tab === 'profile') this.photoDraft = this.user.photo || ''
  }

  renderHeader() {
    return html`
      <header class=${`app-header${this.activeSection === 'finance' && this.activeTab !== 'profile' ? ' finance-header' : ''}`}>
        <a class="brand" href="/" aria-label="Salud Financiera">
          <span class="brand-icon" aria-hidden="true">$</span>
          Salud <span>Financiera</span>
        </a>
        <div class="user-actions">
          ${this.renderAppearanceToggle()}
          <button class="user-profile-button" type="button" aria-label=${`Abrir perfil de ${this.user.name}`}
            title="Mi perfil" @click=${() => this.openFinancialSection('profile')}>
            <img class="profile-photo"
              src=${this.user.photo && !this.brokenPhoto ? this.user.photo : defaultAvatar}
              alt=${`Foto de ${this.user.name}`} referrerpolicy="no-referrer"
              @error=${() => {
                if (!this.user.photo || this.brokenPhoto) return
                this.brokenPhoto = true
                this.error = 'No se pudo cargar tu foto de perfil. Revisa que la URL sea pública y apunte a una imagen en Mi perfil.'
              }} />
            <span class="user-greeting">Hola, <strong>${this.user.name}</strong></span>
          </button>
          <button class="quiet-button" type="button" @click=${this.handleLogout}>Cerrar sesión</button>
        </div>
      </header>
    `
  }

  renderAppearanceToggle() {
    const night = this.effectiveAppearance === 'night'
    const label = night ? 'Activar vista de día' : 'Activar vista de noche'
    return html`
      <button class="quiet-button appearance-toggle" type="button" aria-label=${label}
        title=${label} aria-pressed=${String(night)} @click=${this.toggleAppearance}>
        ${night ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>`
          : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" /></svg>`}
        <span>${night ? 'Día' : 'Noche'}</span>
      </button>
    `
  }

  renderMenu() {
    return html`
      ${this.renderHeader()}
      <main class="dashboard">
        <div class="dashboard-heading">
          <div>
            <p class="eyebrow">TU ESPACIO</p>
            <h1>Menú principal</h1>
            <p>Selecciona la sección que quieres consultar.</p>
          </div>
        </div>
        ${this.error ? html`<div class="error-message dashboard-error" role="alert">${this.error}</div>` : ''}
        <nav class="section-menu" aria-label="Menú principal">
          <button class="section-menu-card" type="button" @click=${() => this.openFinancialSection()}>
            <span class="brand-icon" aria-hidden="true">$</span>
            <strong>Salud financiera</strong>
            <span>Consulta tu panorama, tarjetas, cuentas y movimientos.</span>
            <span class="section-menu-link">Entrar →</span>
          </button>
        </nav>
      </main>
    `
  }

  renderAuth() {
    const registering = this.authMode === 'register'
    const recovering = this.authMode === 'recover'

    return html`
      <main class="auth-page">
        <section class="auth-intro">
          <a class="brand" href="/" aria-label="Salud Financiera">
            <span class="brand-icon" aria-hidden="true">$</span>
            Salud <span>Financiera</span>
          </a>
          <div class="intro-copy">
            <p class="eyebrow">BIENESTAR FINANCIERO, A TU RITMO</p>
            <h1>Más claridad para decidir. <span>Más calma para avanzar.</span></h1>
            <p>Registra tus cuentas y consulta tu información financiera en un solo lugar.</p>
            <div class="privacy-note"><span aria-hidden="true">✓</span> Tus datos se consultan únicamente desde tu usuario.</div>
          </div>
          <p class="auth-footer">Salud Financiera · Tus finanzas, bajo tu control.</p>
        </section>

        <section class="auth-card" aria-labelledby="auth-title">
          <div class="auth-appearance">${this.renderAppearanceToggle()}</div>
          <div class="auth-card-heading">
            <p class="eyebrow">${registering ? 'EMPIEZA AQUÍ' : 'QUÉ BUENO VERTE'}</p>
            <h2 id="auth-title">${registering ? 'Crea tu usuario' : recovering ? 'Recupera tu acceso' : 'Inicia sesión'}</h2>
            <p>${registering
              ? 'Registra tu usuario, foto y palabra clave para empezar a organizar tus finanzas.'
              : recovering ? 'Escribe tu usuario, palabra clave y una contraseña nueva.'
                : 'Entra con el usuario registrado en Salud Financiera.'}</p>
          </div>

          ${this.error ? html`<div class="error-message" role="alert">${this.error}</div>` : ''}
          ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}

          <form class="auth-form" @submit=${this.handleAuthSubmit}>
            <label>
              Nombre de usuario
              <input name="name" type="text" maxlength="100" autocomplete="username" required />
            </label>
            <label>
              ${recovering ? 'Nueva contraseña' : 'Contraseña'}
              <input
                name="password"
                type="password"
                autocomplete=${registering || recovering ? 'new-password' : 'current-password'}
                minlength=${registering || recovering ? '10' : '1'}
                required
              />
              ${registering || recovering ? html`<small>Al menos 10 caracteres, máximo 72 bytes.</small>` : ''}
            </label>
            ${registering ? this.renderPhotoFields() : ''}
            ${registering || recovering ? html`
              <label>
                Palabra clave de recuperación
                <input name="recoveryKey" type="password" minlength="4" maxlength="72" autocomplete="off" required />
                <small>Usa una palabra difícil de adivinar. No distingue mayúsculas; no podemos mostrártela después.</small>
              </label>
            ` : ''}
            <button class="primary-button submit-button" type="submit"
              ?disabled=${this.submitting || (registering && !isValidPhoto(this.photoDraft))}>
              ${this.submitting ? 'Un momento…' : registering ? 'Crear usuario' : recovering ? 'Restablecer contraseña' : 'Entrar'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p class="auth-switch">
            ${registering || recovering ? '¿Ya tienes usuario?' : '¿Primera vez aquí?'}
            <button
              type="button"
              ?disabled=${this.submitting}
              @click=${() => this.setAuthMode(registering || recovering ? 'login' : 'register')}
            >${registering || recovering ? 'Inicia sesión' : 'Crea tu usuario'}</button>
          </p>
          ${!registering && !recovering ? html`
            <p class="auth-switch"><button type="button" ?disabled=${this.submitting}
              @click=${() => this.setAuthMode('recover')}>Olvidé mi contraseña</button></p>
          ` : ''}
        </section>
      </main>
    `
  }

  renderDashboard() {
    return html`
      ${this.renderHeader()}
      ${this.activeTab === 'profile' ? html`
        <main class="dashboard">
          <button class="quiet-button back-to-menu" type="button" @click=${() => { this.activeSection = 'menu' }}>← Menú principal</button>
          ${this.error ? html`<div class="error-message dashboard-error" role="alert">${this.error}</div>` : ''}
          ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
          ${this.renderProfile()}
          <family-settings></family-settings>
        </main>
      ` : html`
        ${this.error ? html`<div class="error-message" role="alert">${this.error}</div>` : ''}
        <salud-financiera @back-to-menu=${() => { this.activeSection = 'menu' }}></salud-financiera>
      `}
    `
  }

  renderProfile() {
    const selectedTheme = themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde'
    return html`
      <section class="data-card profile-settings">
        <div class="section-heading"><h2>Mi perfil</h2></div>
        <label class="theme-label">
          Tema
          <select ?disabled=${this.savingTheme || this.submitting}
            @change=${this.handleThemeChange}>
            ${themes.map(({ id, label }) => html`
              <option value=${id}
                .selected=${id === selectedTheme}
              >${label}</option>
            `)}
          </select>
          <small>${this.savingTheme ? 'Guardando tema…' : 'Cada cambio se guarda automáticamente en tu usuario.'}</small>
        </label>
        <form class="auth-form" @submit=${this.handleProfileSubmit}>
          ${this.renderPhotoFields()}
          <label>
            Nueva palabra clave de recuperación (opcional)
            <input name="recoveryKey" type="password" minlength="4" maxlength="72" autocomplete="off" />
          </label>
          <label>
            Contraseña actual (necesaria si cambias la palabra clave)
            <input name="currentPassword" type="password" autocomplete="current-password" />
          </label>
          <small>Los usuarios existentes deben guardar una palabra clave aquí antes de poder recuperar su contraseña.</small>
          <button class="primary-button" type="submit"
            ?disabled=${this.submitting || this.savingTheme || !isValidPhoto(this.photoDraft)}>
            ${this.submitting ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </form>
      </section>
    `
  }
}

customElements.define('inicio-app', Inicio)
