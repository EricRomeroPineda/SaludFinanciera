import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import './calendario.js'
import styles from './styles.css?inline'
import responsiveStyles from './responsive.css?inline'
import { isValidPhoto, themes } from '../../shared/profile.js'
import defaultAvatar from '../assets/default-avatar.svg'

const moneyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function isCardAccount(account) {
  const type = String(account.type || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return type.includes('tarjeta') || type.includes('credito')
}

class Inicio extends LitElement {
  static styles = [unsafeCSS(styles), unsafeCSS(responsiveStyles)]
  static properties = {
    user: { state: true },
    dashboard: { state: true },
    authMode: { state: true },
    activeTab: { state: true },
    activeSection: { state: true },
    loading: { state: true },
    submitting: { state: true },
    showAccountForm: { state: true },
    showMovementForm: { state: true },
    showSubscriptionForm: { state: true },
    showPlanForm: { state: true },
    editingSubscription: { state: true },
    editingPlan: { state: true },
    movementOperation: { state: true },
    editingMovement: { state: true },
    error: { state: true },
    editingAccount: { state: true },
    newAccountType: { state: true },
    newMovementDefaults: { state: true },
    photoDraft: { state: true },
    notice: { state: true },
    savingTheme: { state: true },
    brokenPhoto: { state: true },
  }

  async handleDeleteAccount(account) {
    if (!window.confirm(`¿Eliminar la cuenta "${account.name}"?`)) return
    this.error = ''
    try {
      await apiRequest(`/api/accounts/${account.id}`, { method: 'DELETE' })
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    }
  }

  async handleCreateSubscription(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true
    const formData = new FormData(event.currentTarget)

    try {
      const id = this.editingSubscription?.id
      await apiRequest(id ? `/api/subscriptions/${id}` : '/api/subscriptions', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          type: formData.get('type'),
          cost: formData.get('cost'),
          frequency: formData.get('frequency'),
          billingDay: formData.get('billingDay') || null,
          paymentType: formData.get('paymentType') || null,
          status: formData.get('status') || 'activa',
        }),
      })
      this.showSubscriptionForm = false
      this.editingSubscription = null
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async handleCreatePlan(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true
    const formData = new FormData(event.currentTarget)

    try {
      const id = this.editingPlan?.id
      await apiRequest(id ? `/api/plans/${id}` : '/api/plans', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          goal: formData.get('goal'),
          unitPeriod: formData.get('unitPeriod') || null,
          periodsRemaining: formData.get('periodsRemaining') || null,
          visible: formData.has('visible'),
        }),
      })
      this.showPlanForm = false
      this.editingPlan = null
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async handleDeleteSubscription(subscription) {
    const action = subscription.status.toLowerCase() === 'activa' ? 'cancelar' : 'eliminar'
    if (!window.confirm(`¿${action === 'cancelar' ? 'Cancelar' : 'Eliminar'} "${subscription.name}"?`)) return
    this.error = ''
    try {
      const result = await apiRequest(`/api/subscriptions/${subscription.id}`, { method: 'DELETE' })
      if (result.cancelled) this.error = 'Se canceló porque tiene movimientos asociados.'
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    }
  }

  async handleDeletePlan(plan) {
    if (!window.confirm(`¿Eliminar el plan "${plan.name}"?`)) return
    this.error = ''
    try {
      await apiRequest(`/api/plans/${plan.id}`, { method: 'DELETE' })
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    }
  }

  async handleSaveMovement(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true

    const formData = new FormData(event.currentTarget)
    const payload = {
      operation: this.movementOperation,
      date: formData.get('date'),
      amount: formData.get('amount'),
      originAccountId: formData.get('originAccountId') || null,
      destinationAccountId: formData.get('destinationAccountId') || null,
      categoryId: formData.get('categoryId') || null,
      planId: formData.get('planId') || null,
      subscriptionId: formData.get('subscriptionId') || this.editingMovement?.subscriptionId || null,
    }
    const editingId = this.editingMovement?.id

    try {
      await apiRequest(editingId ? `/api/movements/${editingId}` : '/api/movements', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      this.showMovementForm = false
      this.editingMovement = null
      this.newMovementDefaults = null
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async handleDeleteMovement(movementId) {
    if (!window.confirm('¿Eliminar este movimiento y revertir sus saldos?')) return
    this.error = ''
    try {
      await apiRequest(`/api/movements/${movementId}`, { method: 'DELETE' })
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    }
  }

  startMovementEdit(movement) {
    this.newMovementDefaults = null
    this.movementOperation = movement.originAccountId && movement.destinationAccountId
      ? 'transfer'
      : movement.originAccountId ? 'expense' : 'income'
    this.editingMovement = {
      ...movement,
      amount: String(movement.amount),
    }
    this.showMovementForm = true
  }

  constructor() {
    super()
    this.user = null
    this.dashboard = null
    this.authMode = 'login'
    this.activeTab = 'overview'
    this.activeSection = 'menu'
    this.loading = true
    this.submitting = false
    this.showAccountForm = false
    this.editingAccount = null
    this.newAccountType = ''
    this.showMovementForm = false
    this.newMovementDefaults = null
    this.showSubscriptionForm = false
    this.showPlanForm = false
    this.editingSubscription = null
    this.editingPlan = null
    this.movementOperation = 'expense'
    this.editingMovement = null
    this.error = ''
    this.photoDraft = ''
    this.notice = ''
    this.savingTheme = false
    this.brokenPhoto = false
  }

  updated(changed) {
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
      await this.refreshDashboard()
    } catch (error) {
      if (error.status !== 401) this.error = error.message
    } finally {
      this.loading = false
    }
  }

  async refreshDashboard() {
    this.dashboard = await apiRequest('/api/dashboard')
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
    if (this.authMode === 'register') payload.photo = this.photoDraft
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
      this.photoDraft = user.photo || ''
      this.activeTab = 'overview'
      this.activeSection = 'menu'
      await this.refreshDashboard()
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
      this.dashboard = null
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
    const theme = event.target.value
    this.error = ''
    this.notice = ''
    this.savingTheme = true
    try {
      const { user } = await apiRequest('/api/auth/theme', {
        method: 'PUT',
        body: JSON.stringify({ theme }),
      })
      this.user = user
      this.notice = 'Tema guardado.'
    } catch (error) {
      this.error = error.message
      event.target.value = themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde'
    } finally {
      this.savingTheme = false
    }
  }

  async handleProfileSubmit(event) {
    event.preventDefault()
    this.error = ''
    this.notice = ''
    this.submitting = true
    const formData = new FormData(event.currentTarget)
    try {
      const { user } = await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          photo: this.photoDraft || this.user.photo,
          theme: themes.some(({ id }) => id === this.user.theme) ? this.user.theme : 'verde',
          recoveryKey: formData.get('recoveryKey'),
          currentPassword: formData.get('currentPassword'),
        }),
      })
      this.user = user
      this.photoDraft = user.photo
      event.target.querySelector('[name="recoveryKey"]').value = ''
      event.target.querySelector('[name="currentPassword"]').value = ''
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

  async handleCreateAccount(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true

    const formData = new FormData(event.currentTarget)
    const optionalNumber = (value) => value === '' ? null : Number(value)

    try {
      const id = this.editingAccount?.id
      await apiRequest(id ? `/api/accounts/${id}` : '/api/accounts', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          type: formData.get('type'),
          total: optionalNumber(formData.get('total')),
          available: optionalNumber(formData.get('available')),
          statementDate: formData.get('statementDate') || null,
          paymentDueDate: formData.get('paymentDueDate') || null,
          paymentToAvoidInterest: optionalNumber(formData.get('paymentToAvoidInterest')),
        }),
      })
      this.showAccountForm = false
      this.editingAccount = null
      this.newAccountType = ''
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  formatMoney(value) {
    return moneyFormatter.format(Number(value) || 0)
  }

  formatDate(value) {
    if (!value) return '—'
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(value)
    return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date)
  }

  startAccountEdit(account) {
    this.editingAccount = account
    this.newAccountType = ''
    this.showAccountForm = true
    this.activeTab = 'accounts'
  }

  startCardPayment(card) {
    this.movementOperation = 'transfer'
    this.editingMovement = null
    this.newMovementDefaults = { destinationAccountId: card.id, cardName: card.name }
    this.showMovementForm = true
    this.activeTab = 'movements'
  }

  startCardCreation() {
    this.editingAccount = null
    this.newAccountType = 'Tarjeta de crédito'
    this.showAccountForm = true
    this.activeTab = 'accounts'
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
      <header class="app-header">
        <a class="brand" href="/" aria-label="Salud Financiera">
          <span class="brand-icon" aria-hidden="true">$</span>
          Salud <span>Financiera</span>
        </a>
        <div class="user-actions">
          <button class="avatar-button" type="button" aria-label="Abrir mi perfil"
            title="Mi perfil" @click=${() => this.openFinancialSection('profile')}>
            <img class="profile-photo"
              src=${this.user.photo && !this.brokenPhoto ? this.user.photo : defaultAvatar}
              alt=${`Foto de ${this.user.name}`} referrerpolicy="no-referrer"
              @error=${() => {
                if (!this.user.photo || this.brokenPhoto) return
                this.brokenPhoto = true
                this.error = 'No se pudo cargar tu foto de perfil. Revisa que la URL sea pública y apunte a una imagen en Mi perfil.'
              }} />
          </button>
          <span class="user-greeting">Hola, <strong>${this.user.name}</strong></span>
          <button class="quiet-button" type="button" @click=${this.handleLogout}>Cerrar sesión</button>
        </div>
      </header>
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
    const tabs = [
      ['overview', 'Panorama'],
      ['cards', 'Tarjetas'],
      ['accounts', 'Cuentas'],
      ['subscriptions', 'Suscripciones'],
      ['plans', 'Planes futuros'],
      ['movements', 'Movimientos'],
      ['calendar', 'Calendario'],
      ['profile', 'Mi perfil'],
    ]

    return html`
      ${this.renderHeader()}

      <main class="dashboard">
        <button class="quiet-button back-to-menu" type="button" @click=${() => {
          this.activeSection = 'menu'
          this.notice = ''
        }}>← Menú principal</button>
        <div class="dashboard-heading">
          <div>
            <p class="eyebrow">TU ESPACIO FINANCIERO</p>
            <h1>Tu panorama</h1>
            <p>La información que ves pertenece a tu usuario.</p>
          </div>
        </div>

        ${this.error ? html`<div class="error-message dashboard-error" role="alert">${this.error}</div>` : ''}
        ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}

        <nav class="tabs" aria-label="Secciones financieras">
          ${tabs.map(([id, label]) => html`
            <button
              class=${this.activeTab === id ? 'tab active' : 'tab'}
              type="button"
              aria-current=${this.activeTab === id ? 'page' : 'false'}
              @click=${() => {
                this.activeTab = id
                this.error = ''
                this.notice = ''
                if (id === 'profile') this.photoDraft = this.user.photo || ''
              }}
            >${label}</button>
          `)}
        </nav>

        ${this.renderActiveTab()}
        <p class="schema-note">
          Los datos se leen del esquema MySQL existente. Deudas y sugerencias no tienen
          tablas propias en ese esquema, por lo que no se muestran como saldos guardados.
        </p>
      </main>
    `
  }

  renderActiveTab() {
    if (this.activeTab === 'profile') return this.renderProfile()
    if (!this.dashboard) return html`<div class="empty-state">No se pudieron cargar tus datos.</div>`
    switch (this.activeTab) {
      case 'cards': return this.renderCards()
      case 'accounts': return this.renderAccounts()
      case 'subscriptions': return this.renderSubscriptions()
      case 'plans': return this.renderPlans()
      case 'movements': return this.renderMovements()
      case 'calendar': return html`<financial-calendar></financial-calendar>`
      default: return this.renderOverview()
    }
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

  renderOverview() {
    const { summary, accounts, subscriptions, plans, movements } = this.dashboard
    const metrics = [
      ['Saldo disponible', this.formatMoney(summary.availableTotal), `${summary.accountsCount} cuentas`],
      ['Suscripciones activas', summary.activeSubscriptionsCount, `${this.formatMoney(summary.monthlySubscriptionTotal)} al mes`],
      ['Planes futuros', summary.plansCount, 'Metas registradas'],
      ['Movimientos recientes', summary.movementsCount, 'Hasta 250 registros'],
    ]

    return html`
      <section class="metric-grid" aria-label="Resumen">
        ${metrics.map(([label, value, detail]) => html`
          <article class="metric-card">
            <p>${label}</p>
            <strong>${value}</strong>
            <small>${detail}</small>
          </article>
        `)}
      </section>

      <div class="overview-grid">
        <section class="data-card">
          <div class="section-heading">
            <div><p class="eyebrow">TUS MEDIOS</p><h2>Cuentas</h2></div>
            <button class="text-button" type="button" @click=${() => { this.activeTab = 'accounts' }}>Ver todas →</button>
          </div>
          ${accounts.length
            ? html`<ul class="compact-list">${accounts.slice(0, 4).map((account) => html`
                <li><span><strong>${account.name}</strong><small>${account.type}</small></span><b>${this.formatMoney(account.available)}</b></li>
              `)}</ul>`
            : this.emptyMessage('Aún no tienes cuentas. Puedes registrar una desde la pestaña Cuentas.')}
        </section>
        <section class="data-card">
          <div class="section-heading">
            <div><p class="eyebrow">ACTIVIDAD</p><h2>Últimos movimientos</h2></div>
            <button class="text-button" type="button" @click=${() => { this.activeTab = 'movements' }}>Ver todos →</button>
          </div>
          ${movements.length
            ? this.renderMovementList(movements.slice(0, 5))
            : this.emptyMessage('Aún no hay movimientos registrados.')}
        </section>
      </div>
      <p class="overview-footnote">${subscriptions.length} suscripciones · ${plans.length} planes futuros</p>
    `
  }

  renderAccounts() {
    const accounts = this.dashboard.accounts
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">REGISTROS DE TU USUARIO</p><h2>Mis cuentas</h2></div>
          <button class="primary-button compact-button" type="button" @click=${() => {
            this.showAccountForm = !this.showAccountForm
            this.editingAccount = null
            this.newAccountType = ''
          }}>
            ${this.showAccountForm ? 'Cancelar' : '+ Nueva cuenta'}
          </button>
        </div>
        ${this.showAccountForm ? this.renderAccountForm() : ''}
        ${accounts.length
          ? html`<div class="table-wrap"><table>
              <thead><tr><th>Cuenta</th><th>Tipo</th><th>Disponible</th><th>Total</th><th>Fecha límite</th><th></th></tr></thead>
              <tbody>${accounts.map((account) => html`
                <tr>
                  <td><strong>${account.name}</strong></td>
                  <td>${account.type}</td>
                  <td>${this.formatMoney(account.available)}</td>
                  <td>${account.total == null ? '—' : this.formatMoney(account.total)}</td>
                  <td>${this.formatDate(account.paymentDueDate)}</td>
                  <td class="row-actions">
                    <button class="text-button" type="button" @click=${() => {
                      this.startAccountEdit(account)
                    }}>Editar</button>
                    <button class="text-button delete-button" type="button" @click=${() => this.handleDeleteAccount(account)}>Eliminar</button>
                  </td>
                </tr>
              `)}</tbody>
            </table></div>`
          : this.emptyMessage('No tienes cuentas todavía. Registra una para empezar.')}
      </section>
    `
  }

  renderAccountForm() {
    const account = this.editingAccount || {}
    return html`
      <form class="account-form" @submit=${this.handleCreateAccount}>
        <label>Nombre<input name="name" maxlength="100" placeholder="Cuenta principal" .value=${account.name || ''} required /></label>
        <label>Tipo<input name="type" maxlength="40" placeholder="Débito, efectivo, crédito…" .value=${account.type || this.newAccountType || ''} required /></label>
        ${this.editingAccount
          ? html`<p class="form-hint">El saldo disponible se modifica mediante movimientos para mantener el historial.</p>`
          : html`<label>Disponible<input name="available" type="number" min="0" step="0.01" value="0" /></label>`}
        <label>Total / límite<input name="total" type="number" min="0" step="0.01" .value=${account.total ?? ''} /></label>
        <label>Fecha de corte<input name="statementDate" type="date" .value=${account.statementDate || ''} /></label>
        <label>Fecha límite de pago<input name="paymentDueDate" type="date" .value=${account.paymentDueDate || ''} /></label>
        <label>Pago para evitar intereses<input name="paymentToAvoidInterest" type="number" min="0" step="0.01" .value=${account.paymentToAvoidInterest ?? ''} /></label>
        <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>${this.editingAccount ? 'Guardar cambios' : 'Guardar cuenta'}</button></div>
      </form>
    `
  }

  renderCards() {
    const cards = this.dashboard.accounts.filter(isCardAccount)
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">TARJETAS Y LÍNEAS DE CRÉDITO</p><h2>Mis tarjetas</h2></div>
          <button class="primary-button compact-button" type="button" @click=${this.startCardCreation}>+ Nueva tarjeta</button>
        </div>
        ${cards.length
          ? html`<div class="card-grid">
              ${cards.map((card) => html`
                <article class="credit-card">
                  <div class="credit-card-heading">
                    <div><p>${card.type}</p><h3>${card.name}</h3></div>
                    <span class="card-chip" aria-hidden="true">▦</span>
                  </div>
                  <div class="card-balances">
                    <div><span>Disponible</span><strong>${this.formatMoney(card.available)}</strong></div>
                    <div><span>Límite total</span><strong>${card.total == null ? '—' : this.formatMoney(card.total)}</strong></div>
                  </div>
                  <dl class="card-dates">
                    <div><dt>Fecha de corte</dt><dd>${this.formatDate(card.statementDate)}</dd></div>
                    <div><dt>Fecha límite de pago</dt><dd>${this.formatDate(card.paymentDueDate)}</dd></div>
                    <div class="card-payment">
                      <dt>Pago para evitar intereses</dt>
                      <dd>${card.paymentToAvoidInterest == null
                        ? '—'
                        : this.formatMoney(card.paymentToAvoidInterest)}</dd>
                    </div>
                  </dl>
                  <div class="card-actions">
                    <button class="text-button" type="button" @click=${() => this.startCardPayment(card)}>Registrar pago</button>
                    <button class="text-button" type="button" @click=${() => this.startAccountEdit(card)}>Editar tarjeta</button>
                    <button class="text-button delete-button" type="button" @click=${() => this.handleDeleteAccount(card)}>Eliminar</button>
                  </div>
                </article>
              `)}
            </div>`
          : html`
            <div class="empty-state card-empty">
              <p>No encontramos tarjetas en tus cuentas.</p>
              <p>Agrega una como “Tarjeta de crédito” para registrar su límite y fechas de pago.</p>
            </div>
          `}
      </section>
    `
  }

  renderSubscriptions() {
    const items = this.dashboard.subscriptions
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">PAGOS RECURRENTES</p><h2>Suscripciones y servicios</h2></div>
          <button class="primary-button compact-button" type="button" @click=${() => {
            this.editingSubscription = null
            this.showSubscriptionForm = !this.showSubscriptionForm
          }}>
            ${this.showSubscriptionForm ? 'Cancelar' : '+ Nueva'}
          </button>
        </div>
        ${this.showSubscriptionForm ? html`
          <form class="module-form" @submit=${this.handleCreateSubscription}>
            <label>Nombre<input name="name" maxlength="100" .value=${this.editingSubscription?.name || ''} required /></label>
            <label>Tipo
              <select name="type" .value=${this.editingSubscription?.type || 'suscripcion'} required>
                <option value="suscripcion">Suscripción</option>
                <option value="servicio">Servicio</option>
              </select>
            </label>
            <label>Costo<input name="cost" type="number" min="0.01" step="0.01" .value=${this.editingSubscription?.cost || ''} required /></label>
            <label>Frecuencia
              <select name="frequency" .value=${this.editingSubscription?.frequency || 'Mensual'} required>
                <option value="Mensual">Mensual</option>
                <option value="Anual">Anual</option>
                <option value="Semestral">Semestral</option>
                <option value="Trimestral">Trimestral</option>
              </select>
            </label>
            <label>Día de cobro<input name="billingDay" type="number" min="1" max="31" .value=${this.editingSubscription?.billingDay || ''} /></label>
            <label>Método de pago<input name="paymentType" maxlength="40" .value=${this.editingSubscription?.paymentType || ''} /></label>
            ${this.editingSubscription ? html`
              <label>Estado
                <select name="status" .value=${this.editingSubscription.status}>
                  <option value="activa">Activa</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </label>
            ` : ''}
            <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>Guardar</button></div>
          </form>
        ` : ''}
        ${items.length
          ? html`<div class="table-wrap"><table>
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Frecuencia</th><th>Costo</th><th>Mensual</th><th>Estado</th><th></th></tr></thead>
              <tbody>${items.map((item) => html`
                <tr>
                  <td><strong>${item.name}</strong></td><td>${item.type}</td><td>${item.frequency}</td>
                  <td>${this.formatMoney(item.cost)}</td>
                  <td>${item.monthlyCost == null ? '—' : this.formatMoney(item.monthlyCost)}</td>
                  <td><span class="status-tag ${item.status.toLowerCase() === 'activa' ? '' : 'inactive'}">${item.status}</span></td>
                  <td class="row-actions">
                    <button class="text-button" type="button" @click=${() => {
                      this.editingSubscription = item
                      this.showSubscriptionForm = true
                    }}>Editar</button>
                    <button class="text-button delete-button" type="button" @click=${() => this.handleDeleteSubscription(item)}>
                      ${item.status.toLowerCase() === 'activa' ? 'Cancelar' : 'Eliminar'}
                    </button>
                  </td>
                </tr>
              `)}</tbody>
            </table></div>`
          : this.emptyMessage('No tienes suscripciones registradas.')}
      </section>
    `
  }

  renderPlans() {
    const items = this.dashboard.plans
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">METAS FINANCIERAS</p><h2>Planes futuros</h2></div>
          <button class="primary-button compact-button" type="button" @click=${() => {
            this.editingPlan = null
            this.showPlanForm = !this.showPlanForm
          }}>
            ${this.showPlanForm ? 'Cancelar' : '+ Nuevo plan'}
          </button>
        </div>
        ${this.showPlanForm ? html`
          <form class="module-form" @submit=${this.handleCreatePlan}>
            <label>Nombre de la meta<input name="name" maxlength="100" .value=${this.editingPlan?.name || ''} required /></label>
            <label>Monto objetivo<input name="goal" type="number" min="0.01" step="0.01" .value=${this.editingPlan?.goal || ''} required /></label>
            <label>Unidad de periodo
              <select name="unitPeriod" .value=${this.editingPlan?.periodUnit || ''}>
                <option value="">Sin periodo</option>
                <option value="semana">Semana</option>
                <option value="mes">Mes</option>
                <option value="anio">Año</option>
              </select>
            </label>
            <label>Periodos faltantes<input name="periodsRemaining" type="number" min="0" step="1" .value=${this.editingPlan?.periodsRemaining ?? ''} /></label>
            <label class="checkbox-label"><input name="visible" type="checkbox" ?checked=${this.editingPlan ? Boolean(this.editingPlan.visible) : true} /> Mostrar en el panorama</label>
            <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>Guardar plan</button></div>
          </form>
        ` : ''}
        ${items.length
          ? html`<div class="table-wrap"><table>
              <thead><tr><th>Meta</th><th>Objetivo</th><th>Ahorrado</th><th>Faltante</th><th>Periodo</th><th></th></tr></thead>
              <tbody>${items.map((item) => html`
                <tr>
                  <td><strong>${item.name}</strong></td><td>${this.formatMoney(item.goal)}</td>
                  <td>${this.formatMoney(item.saved)}</td><td>${this.formatMoney(item.remaining)}</td>
                  <td>${item.periodUnit || '—'}</td>
                  <td class="row-actions">
                    <button class="text-button" type="button" @click=${() => {
                      this.editingPlan = item
                      this.showPlanForm = true
                    }}>Editar</button>
                    <button class="text-button delete-button" type="button" @click=${() => this.handleDeletePlan(item)}>Eliminar</button>
                  </td>
                </tr>
              `)}</tbody>
            </table></div>`
          : this.emptyMessage('No tienes planes futuros registrados.')}
      </section>
    `
  }

  renderMovements() {
    const items = this.dashboard.movements
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">HISTORIAL</p><h2>Movimientos recientes</h2></div>
          <button class="primary-button compact-button" type="button" @click=${() => {
            this.editingMovement = null
            this.newMovementDefaults = null
            this.movementOperation = 'expense'
            this.showMovementForm = !this.showMovementForm
          }}>${this.showMovementForm ? 'Cancelar' : '+ Nuevo movimiento'}</button>
        </div>
        ${this.showMovementForm ? this.renderMovementForm() : ''}
        ${items.length
          ? this.renderMovementList(items, true)
          : this.emptyMessage('No tienes movimientos registrados.')}
      </section>
    `
  }

  renderMovementForm() {
    const movement = this.editingMovement || {}
    const originAccountId = movement.originAccountId || this.newMovementDefaults?.originAccountId
    const destinationAccountId = movement.destinationAccountId
      || this.newMovementDefaults?.destinationAccountId
    const categories = this.dashboard.categories.filter((category) => {
      if (this.movementOperation === 'transfer') return false
      return category.type === (this.movementOperation === 'income' ? 'ingreso' : 'gasto')
    })
    const accounts = this.dashboard.accounts

    return html`
      <form class="movement-form" @submit=${this.handleSaveMovement}>
        ${this.newMovementDefaults?.cardName
          ? html`<p class="form-hint">Registra una transferencia hacia ${this.newMovementDefaults.cardName} para reflejar el pago en el saldo disponible.</p>`
          : ''}
        <label>Operación
          <select
            name="operation"
            .value=${this.movementOperation}
            @change=${(event) => { this.movementOperation = event.currentTarget.value }}
          >
            <option value="expense">Gasto</option>
            <option value="income" ?selected=${this.movementOperation === 'income'}>Ingreso</option>
            <option value="transfer" ?selected=${this.movementOperation === 'transfer'}>Transferencia</option>
          </select>
        </label>
        <label>Fecha<input name="date" type="date" .value=${movement.date || new Date().toISOString().slice(0, 10)} required /></label>
        <label>Monto<input name="amount" type="number" min="0.01" step="0.01" .value=${movement.amount || ''} required /></label>
        ${this.movementOperation !== 'income' ? html`
          <label>Cuenta de origen
            <select name="originAccountId" required .value=${String(originAccountId || '')}>
              <option value="" ?selected=${!originAccountId}>Selecciona una cuenta</option>
              ${accounts.map((account) => html`<option value=${account.id} ?selected=${Number(originAccountId) === Number(account.id)}>${account.name} · ${this.formatMoney(account.available)}</option>`)}
            </select>
          </label>
        ` : ''}
        ${this.movementOperation !== 'expense' ? html`
          <label>Cuenta de destino
            <select name="destinationAccountId" required .value=${String(destinationAccountId || '')}>
              <option value="" ?selected=${!destinationAccountId}>Selecciona una cuenta</option>
              ${accounts.map((account) => html`<option value=${account.id} ?selected=${Number(destinationAccountId) === Number(account.id)}>${account.name}</option>`)}
            </select>
          </label>
        ` : ''}
        ${this.movementOperation !== 'transfer' ? html`
          <label>Categoría
            <select name="categoryId" .value=${String(movement.categoryId || '')}>
              <option value="" ?selected=${!movement.categoryId}>Sin categoría</option>
              ${categories.map((category) => html`<option value=${category.id} ?selected=${Number(movement.categoryId) === Number(category.id)}>${category.name}</option>`)}
            </select>
          </label>
        ` : ''}
        ${this.movementOperation === 'expense' ? html`
          <label>Suscripción relacionada (opcional)
            <select name="subscriptionId" .value=${String(movement.subscriptionId || '')}>
              <option value="" ?selected=${!movement.subscriptionId}>Sin suscripción</option>
              ${this.dashboard.subscriptions.map((subscription) => html`<option value=${subscription.id} ?selected=${Number(movement.subscriptionId) === Number(subscription.id)}>${subscription.name}</option>`)}
            </select>
          </label>
          <label>Aportación a plan (opcional)
            <select name="planId" .value=${String(movement.planId || '')}>
              <option value="" ?selected=${!movement.planId}>Sin plan</option>
              ${this.dashboard.plans.map((plan) => html`<option value=${plan.id} ?selected=${Number(movement.planId) === Number(plan.id)}>${plan.name}</option>`)}
            </select>
          </label>
        ` : ''}
        <div class="form-actions">
          <button class="primary-button compact-button" ?disabled=${this.submitting}>
            ${this.submitting ? 'Guardando…' : this.editingMovement ? 'Guardar cambios' : 'Registrar movimiento'}
          </button>
        </div>
      </form>
    `
  }

  renderMovementList(items, actions = false) {
    return html`<ul class="movement-list">${items.map((item) => {
      const isTransfer = item.originAccount && item.destinationAccount
      const isIncome = item.categoryType === 'ingreso' ||
        (!item.originAccountId && Boolean(item.destinationAccountId))
      return html`
        <li>
          <span class="movement-mark ${isIncome ? 'income' : isTransfer ? 'transfer' : 'expense'}">${isIncome ? '+' : isTransfer ? '↔' : '−'}</span>
          <span class="movement-description">
            <strong>${item.category || item.planName || item.subscriptionName || 'Movimiento'}</strong>
            <small>${item.originAccount && item.destinationAccount
              ? `${item.originAccount} → ${item.destinationAccount}`
              : item.originAccount || item.destinationAccount || item.planName || item.subscriptionName || 'Sin cuenta relacionada'}</small>
          </span>
          <span class="movement-amount">
            <strong>${this.formatMoney(item.amount)}</strong>
            <small>${this.formatDate(item.date)}</small>
          </span>
          ${actions ? html`
            <span class="movement-actions">
              <button class="text-button" type="button" @click=${() => this.startMovementEdit(item)}>Editar</button>
              <button class="text-button delete-button" type="button" @click=${() => this.handleDeleteMovement(item.id)} aria-label="Eliminar movimiento">×</button>
            </span>
          ` : ''}
        </li>
      `
    })}</ul>`
  }

  emptyMessage(message) {
    return html`<p class="empty-state">${message}</p>`
  }
}

customElements.define('inicio-app', Inicio)
