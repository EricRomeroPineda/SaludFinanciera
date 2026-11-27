import { LitElement, html, unsafeCSS } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { apiRequest } from '../api.js'
import '../../saludFinanciera/frontend/salud-financiera.js'
import appearanceStyles from './appearance.css?inline'
import styles from './styles.css?inline'
import responsiveStyles from './responsive.css?inline'
import { themes } from '../../shared/profile.js'
import packageInfo from '../../package.json' with { type: 'json' }
import defaultAvatar from '../assets/default-avatar.svg'
import './familia.js'
import './email-settings.js'
import './photo-editor.js'
import './access-recovery.js'
import '../../saludFinanciera/frontend/card-catalog-admin.js'
import { invalidateCardImages } from '../../saludFinanciera/frontend/card-catalog-image.js'
import { userRoleLabel } from '../../shared/user-roles.js'
import './user-management.js'
import './account-removal.js'
import { upcomingSections } from '../sections/sections.js'
import { sectionIcon } from '../sections/icons.js'
import '../sections/section-preview.js'

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
    photoFile: { state: true },
    photoPreview: { state: true },
    notice: { state: true },
    savingTheme: { state: true },
    brokenPhoto: { state: true },
    appearance: { state: true },
    showThemePicker: { state: true },
    styleError: { state: true },
    emailLink: { state: true },
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
    this.showThemePicker = false
    this.styleError = ''
  }

  get effectiveAppearance() {
    return this.user?.appearance || this.appearance || (this.user?.theme === 'oscuro' ? 'night' : 'day')
  }

  async toggleAppearance() {
    if (this.savingTheme || this.submitting) return
    const appearance = this.effectiveAppearance === 'night' ? 'day' : 'night'
    if (!this.user) {
      this.appearance = appearance
      return
    }
    this.savingTheme = true
    this.styleError = ''
    try {
      const { user } = await apiRequest('/api/auth/theme', {
        method: 'PUT', body: JSON.stringify({ appearance }),
      })
      this.user = user
      this.appearance = null
    } catch (error) {
      this.styleError = error.message
    } finally {
      this.savingTheme = false
    }
  }

  updated(changed) {
    if (changed.has('showThemePicker')) {
      const dialog = this.renderRoot.querySelector('#theme-picker')
      if (this.showThemePicker && dialog && !dialog.open) dialog.showModal()
      else if (!this.showThemePicker && dialog?.open) dialog.close()
    }
    if (changed.has('user') || changed.has('appearance')) {
      this.setAttribute('data-appearance', this.effectiveAppearance)
    }
    if (changed.has('user')) {
      if (changed.get('user')?.id !== this.user?.id) invalidateCardImages()
      const theme = themes.some(({ id }) => id === this.user?.theme) ? this.user.theme : 'verde'
      this.setAttribute('data-theme', theme)
      if (changed.get('user')?.photo !== this.user?.photo) this.brokenPhoto = false
    }
  }

  connectedCallback() {
    super.connectedCallback()
    this.emailLinkListener = () => this.readEmailLink()
    window.addEventListener('hashchange', this.emailLinkListener)
    this.readEmailLink()
    this.restoreSession()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('hashchange', this.emailLinkListener)
    if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
  }

  readEmailLink() {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const query = new URLSearchParams(window.location.search)
    for (const purpose of ['verify-email', 'reset-recovery', 'reset-password']) {
      const token = params.get(purpose) || query.get(purpose)
      if (token) {
        this.emailLink = { purpose, token }
        window.history.replaceState(null, '', window.location.pathname)
        break
      }
    }
  }

  async restoreSession() {
    try {
      const { user } = await apiRequest('/api/auth/me')
      this.user = user
      this.activeSection = 'menu'
      this.appearance = null
      this.styleError = ''
      this.showThemePicker = false
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
    const registering = this.authMode === 'register'
    if (registering) {
      payload.photo = null
      payload.email = formData.get('email')
    }
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
      if (registering) {
        this.notice = 'Cuenta creada. Verifica tu correo desde Mi perfil; si no lo verificas, no podrás recuperar tu acceso.'
        if (this.photoFile) {
          try {
            const { photo } = await apiRequest('/api/auth/photo', {
              method: 'POST', headers: { 'Content-Type': this.photoFile.type }, body: this.photoFile,
            })
            this.user = { ...user, photo }
            this.photoFile = null
            if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
            this.photoPreview = ''
          } catch (error) {
            this.error = `Tu cuenta se creó, pero no se pudo guardar la foto: ${error.message}. Puedes volver a subirla desde Mi perfil.`
          }
        }
      }
      this.appearance = null
      this.photoDraft = this.user.photo || ''
      this.activeTab = registering ? 'profile' : 'overview'
      this.activeSection = registering ? 'finance' : 'menu'
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
      if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
      this.photoPreview = ''
      this.photoFile = null
      this.user = null
      this.appearance = null
      this.authMode = 'login'
      this.activeSection = 'menu'
      this.showThemePicker = false
      this.styleError = ''
      this.photoDraft = ''
      this.notice = ''
    } catch (error) {
      this.error = error.message
    }
  }

  setAuthMode(mode) {
    if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
    this.photoFile = null
    this.photoPreview = ''
    this.authMode = mode
    this.error = ''
    this.notice = ''
    this.photoDraft = ''
    this.renderRoot.querySelector('.auth-form')?.reset()
  }

  async handleThemeChange(event) {
    if (this.savingTheme || this.submitting) return
    const theme = event.currentTarget.value
    this.error = ''
    this.notice = ''
    this.savingTheme = true
    this.styleError = ''
    try {
      const { user } = await apiRequest('/api/auth/theme', {
        method: 'PUT',
        body: JSON.stringify({ theme }),
      })
      this.user = user
      this.appearance = null
      this.showThemePicker = false
    } catch (error) {
      this.styleError = error.message
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
    let uploaded = false
    try {
      if (this.photoFile) {
        const { photo } = await apiRequest('/api/auth/photo', {
          method: 'POST', headers: { 'Content-Type': this.photoFile.type }, body: this.photoFile,
        })
        this.user = { ...this.user, photo }
        this.photoDraft = photo
        this.photoFile = null
        if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
        this.photoPreview = ''
        uploaded = true
      }
      const { user } = await apiRequest(`/api/users/${this.user.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          photo: formData.has('photoUrl') ? String(formData.get('photoUrl') || '').trim() : this.user.photo ?? null,
          theme: themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde',
          ...(formData.has('name') ? { name: String(formData.get('name') || '').trim() } : {}),
        }),
      })
      this.user = user
      this.photoDraft = user.photo
      this.notice = 'Perfil guardado.'
    } catch (error) {
      this.error = uploaded ? `La foto se guardó, pero no se pudo actualizar el perfil: ${error.message}` : error.message
    } finally {
      this.submitting = false
    }
  }

  renderPhotoFields() {
    return html`
      <div class="profile-photo-editor">
        <img class="profile-photo preview-photo" src=${this.photoPreview || this.user?.photo || defaultAvatar}
          alt="Vista previa de tu foto" referrerpolicy="no-referrer"
          @error=${(event) => {
            if (!event.target.src.endsWith(defaultAvatar)) {
              event.target.src = defaultAvatar
              this.error = 'No se pudo mostrar la foto guardada. Puedes elegir otra desde el lápiz.'
            }
          }} />
        <button class="photo-pencil quiet-button" type="button" aria-label="Editar foto de perfil" title="Editar foto de perfil"
          ?disabled=${this.submitting} @click=${() => this.renderRoot.querySelector('photo-editor').open()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="m16 3 5 5L8 21H3v-5L16 3Z M13 6l5 5" />
          </svg>
        </button>
      </div>
      <small>Foto opcional. Pulsa el lápiz para seleccionar y ajustar tu foto.</small>
      <photo-editor .src=${this.photoPreview || this.user?.photo || ''} @photo-edited=${(event) => {
        if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
        this.photoFile = event.detail
        this.photoPreview = URL.createObjectURL(event.detail)
        this.error = ''
      }}></photo-editor>
    `
  }

  render() {
    if (this.emailLink) return html`<main class="dashboard">
      ${keyed(this.emailLink.token, html`<email-settings .purpose=${this.emailLink.purpose} .token=${this.emailLink.token}></email-settings>`)}
    </main>`
    if (this.loading) {
      return html`<main class="loading-screen"><span class="spinner"></span><p>Cargando Salud Financiera…</p></main>`
    }

    if (!this.user) return this.renderAuth()
    const previewSection = upcomingSections.find((section) => section.id === this.activeSection)
    if (previewSection) return html`${this.renderHeader()}<main class="dashboard">
      <button class="quiet-button back-to-menu" type="button" @click=${() => { this.activeSection = 'menu' }}>← Menú principal</button>
      <section-preview .section=${previewSection}></section-preview>
    </main>`
    if (this.activeSection === 'user-management') {
      return html`${this.renderHeader()}<main class="dashboard">
        <button class="quiet-button back-to-menu" type="button" @click=${() => { this.activeSection = 'menu' }}>← Menú principal</button>
        ${this.user.role === 'admin' ? html`<user-management @user-role-updated=${(event) => {
          if (Number(event.detail.id) === Number(this.user.id)) this.user = { ...this.user, role: event.detail.role }
        }} @account-removed=${this.handleAccountRemoved}></user-management>` : html`<p class="error-message" role="alert">Solo un administrador puede gestionar cuentas.</p>`}
      </main>`
    }
    if (this.activeSection === 'card-catalog') {
      return html`${this.renderHeader()}<main class="dashboard">
        <button class="quiet-button back-to-menu" type="button" @click=${() => { this.activeSection = 'menu' }}>← Menú principal</button>
        ${this.user.role === 'admin' ? html`<card-catalog-admin></card-catalog-admin>`
          : html`<p class="error-message" role="alert">Solo un administrador puede configurar este catálogo.</p>`}
      </main>`
    }
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
        <a class="brand" href="/" aria-label=${this.activeSection === 'menu' ? 'lifekit.work' : 'Salud Financiera'}>
          <span class="brand-icon" aria-hidden="true">${this.activeSection === 'menu' ? 'L' : '$'}</span>
          ${this.activeSection === 'menu' ? html`lifekit<span>.work</span>` : html`Salud <span>Financiera</span>`}
        </a>
        <div class="user-actions">
          ${this.renderAppearanceToggle()}
          ${this.renderThemeToggle()}
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
          <span class="user-role-badge" data-role=${this.user.role} aria-label=${`Tipo de cuenta: ${userRoleLabel(this.user.role)}`}>${userRoleLabel(this.user.role)}</span>
          <button class="quiet-button" type="button" @click=${this.handleLogout}>Cerrar sesión</button>
        </div>
      </header>
      ${this.styleError && !this.showThemePicker ? html`<p class="error-message style-error" role="alert">${this.styleError}</p>` : ''}
      ${this.renderThemePicker()}
    `
  }

  renderAppearanceToggle() {
    const night = this.effectiveAppearance === 'night'
    const label = night ? 'Activar vista de día' : 'Activar vista de noche'
    return html`
      <button class="quiet-button appearance-toggle" type="button" aria-label=${label}
        title=${label} aria-pressed=${String(night)} ?disabled=${this.savingTheme || this.submitting} @click=${this.toggleAppearance}>
        ${night ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>`
          : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" /></svg>`}
        <span>${night ? 'Día' : 'Noche'}</span>
      </button>
    `
  }

  renderThemeToggle() {
    return html`<button class="quiet-button appearance-toggle theme-toggle" type="button"
      aria-label="Elegir color del tema" title="Elegir color del tema" aria-haspopup="dialog"
      ?disabled=${this.savingTheme || this.submitting}
      @click=${() => { this.styleError = ''; this.showThemePicker = true }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" />
        <circle cx="7.5" cy="10" r=".7" /><circle cx="10" cy="6.5" r=".7" /><circle cx="14.5" cy="7" r=".7" /><circle cx="17.5" cy="10.5" r=".7" /></svg>
    </button>`
  }

  renderThemePicker() {
    return html`<dialog id="theme-picker" class="theme-dialog" aria-labelledby="theme-picker-title"
      @cancel=${(event) => {
        event.preventDefault()
        if (!this.savingTheme) this.showThemePicker = false
      }}>
      <div class="section-heading"><h2 id="theme-picker-title">Color del tema</h2>
        <button class="quiet-button" type="button" ?disabled=${this.savingTheme}
          @click=${() => { this.showThemePicker = false }}>Cerrar</button></div>
      <p>El color se aplica al fondo, paneles y controles. Día y noche se guardan por separado del color.</p>
      <div class="theme-options">${themes.map(({ id, label }) => html`
        <button class="theme-option" data-color=${id} type="button" value=${id}
          aria-pressed=${String(this.user?.theme === id)} ?disabled=${this.savingTheme || this.submitting}
          @click=${this.handleThemeChange}><span class="theme-swatch" aria-hidden="true"></span>${label}</button>
      `)}</div>
      ${this.savingTheme ? html`<p role="status">Guardando apariencia…</p>` : ''}
      ${this.styleError ? html`<p class="error-message" role="alert">${this.styleError}</p>` : ''}
    </dialog>`
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
        ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
        <div class=${`menu-layout${this.user.role === 'admin' ? ' with-admin' : ''}`}>
        <nav class="section-menu" aria-label="Menú principal">
          <article class="section-menu-card">
            <span class="section-menu-icon">${sectionIcon('finance')}</span>
            <span class="section-status active">Activo</span>
            <strong>Salud financiera</strong>
            <span>Consulta tu panorama, tarjetas, cuentas y movimientos.</span>
            <div class="section-menu-actions">
              <button class="section-menu-link section-menu-enter" type="button" aria-label="Entrar a Salud financiera"
                @click=${() => this.openFinancialSection()}>Entrar →</button>
              ${this.user.role === 'admin' ? html`<button class="section-menu-admin-button" type="button"
                @click=${() => { this.activeSection = 'card-catalog' }}>Agregar info de tarjetas nuevas</button>` : ''}
            </div>
          </article>
          ${upcomingSections.map((section) => html`<article class="section-menu-card upcoming-section">
            <span class="section-menu-icon">${sectionIcon(section.icon)}</span>
            <span class="section-status pending">En proceso</span>
            <strong>${section.name}</strong>
            <span>${section.description}</span>
            <button class="section-menu-link section-menu-enter" type="button" aria-label=${`Ver vista previa de ${section.name}`}
              @click=${() => { this.activeSection = section.id }}>Ver vista previa →</button>
          </article>`)}
        </nav>
          ${this.user.role === 'admin' ? html`<aside class="admin-menu" aria-label="Administración">
            <h2>Administración</h2>
            <article class="section-menu-card">
            <span class="section-menu-icon">${sectionIcon('admin')}</span>
            <span class="section-status active">Activo · Solo Admin</span>
            <strong>Gestión de cuentas</strong>
            <span>Consulta usuarios y asigna los roles Admin, Free o VIP.</span>
            <button class="section-menu-link" type="button" @click=${() => { this.activeSection = 'user-management' }}>Gestionar cuentas →</button>
          </article></aside>` : ''}
        </div>
        <p class="menu-version">Versión ${packageInfo.version}</p>
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
              ? 'Registra tu usuario, correo y palabra clave. La foto de perfil es opcional.'
              : recovering ? 'Recupera tu acceso con tu correo verificado.'
                : 'Entra con tu usuario o correo verificado en Salud Financiera.'}</p>
          </div>

          ${this.error ? html`<div class="error-message" role="alert">${this.error}</div>` : ''}
          ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}

          ${recovering ? html`<access-recovery></access-recovery>` : html`<form class="auth-form" @submit=${this.handleAuthSubmit}>
            <label>
              ${registering || recovering ? 'Nombre de usuario' : 'Usuario o correo electrónico'}
              <input name="name" type="text" maxlength=${registering || recovering ? '100' : '254'} autocomplete="username" required />
            </label>
            ${registering ? html`<label>Correo electrónico
              <input name="email" type="email" maxlength="254" autocomplete="email" required />
            </label>
            <p class="privacy-note" role="note">Si no verificas tu correo, no podrás recuperar tu acceso. Podrás verificarlo después desde Mi perfil.</p>` : ''}
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
              ?disabled=${this.submitting}>
              ${this.submitting ? 'Un momento…' : registering ? 'Crear usuario' : recovering ? 'Restablecer contraseña' : 'Entrar'}
              <span aria-hidden="true">→</span>
            </button>
          </form>`}

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
          <email-settings .user=${this.user} @email-updated=${(event) => { this.user = event.detail }}></email-settings>
          <family-settings></family-settings>
        </main>
      ` : html`
        ${this.error ? html`<div class="error-message" role="alert">${this.error}</div>` : ''}
        <salud-financiera @back-to-menu=${() => { this.activeSection = 'menu' }}></salud-financiera>
      `}
    `
  }

  renderProfile() {
    return html`
      <section class="data-card profile-settings">
        <div class="section-heading"><h2>Mi perfil</h2></div>
        <form class="auth-form" @submit=${this.handleProfileSubmit}>
          ${this.renderPhotoFields()}
          <label>Nombre de usuario
            <input name="name" type="text" autocomplete="username" maxlength="100" required
              .value=${this.user?.name || ''} ?disabled=${this.submitting} />
          </label>
          <small>Usa el nuevo usuario para iniciar sesión. Tu correo verificado no cambia.</small>
          <button class="primary-button" type="submit"
            ?disabled=${this.submitting || this.savingTheme}>
            ${this.submitting ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </form>
      </section>
      <account-removal .userId=${this.user?.id} .userName=${this.user?.name}
        @account-removed=${this.handleAccountRemoved}></account-removal>
    `
  }

  handleAccountRemoved(event) {
    const { id, deleted, warning } = event.detail
    if (Number(id) !== Number(this.user?.id)) return
    this.notice = deleted ? 'Tu cuenta se eliminó definitivamente.' : 'Tu información financiera se borró y te desvinculaste de la familia.'
    this.error = warning || ''
    this.activeSection = 'menu'
    this.activeTab = 'overview'
    if (this.photoPreview) URL.revokeObjectURL(this.photoPreview)
    this.photoPreview = ''
    this.photoFile = null
    if (deleted) this.user = null
  }
}

customElements.define('inicio-app', Inicio)
