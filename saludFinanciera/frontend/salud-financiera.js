import { LitElement, html, svg, unsafeCSS } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { apiRequest } from '../../src/api.js'
import { isCreditAccount, isDebitAccount, isCashAccount, isMoneyAccount } from '../account-types.js'
import { calculateAccountSummary, calculatePeriodActivity, cardPaymentStatus } from '../account-summary.js'
import { movementLabel, movementOrigin, movementDestination } from '../movement-labels.js'
import { calculatePlanProjection } from '../plan-calculations.js'
import { addIcon, editIcon, sortByDue, viewToggle } from './record-view.js'
import { accountThemeStyle } from './account-theme.js'
import { renderCardImage } from './card-catalog-image.js'
import sharedStyles from '../../src/inicio/styles.css?inline'
import styles from './styles.css?inline'
import responsiveStyles from './responsive.css?inline'
import './calendario.js'
import './related-movements.js'
import './prestamos.js'
import './movement-evidence.js'
import { depositStyles, renderDeposit } from './copy-deposit.js'
import '../suscripciones/suscripciones.js'

const moneyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

function localDateInput() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isCardAccount(account) {
  const type = String(account.type || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return type.includes('tarjeta') || isCreditAccount(type) || isDebitAccount(type) || isCashAccount(type)
}

class SaludFinanciera extends LitElement {
  static styles = [unsafeCSS(sharedStyles), unsafeCSS(styles), unsafeCSS(responsiveStyles), depositStyles]
  static properties = {
    dashboard: { state: true },
    familyView: { state: true },
    familyAvailable: { state: true },
    familyError: { state: true },
    activeTab: { state: true },
    selectedCard: { state: true },
    today: { state: true },
    overviewPeriod: { state: true },
    overviewScope: { state: true },
    overviewPickerYear: { state: true },
    cardsListView: { state: true },
    plansListView: { state: true },
    loading: { state: true },
    submitting: { state: true },
    showAccountForm: { state: true },
    showMovementForm: { state: true },
    showPlanForm: { state: true },
    editingPlan: { state: true },
    planUnit: { state: true },
    selectedPlan: { state: true },
    pendingDeletePlan: { state: true },
    movementOperation: { state: true },
    movementMode: { state: true },
    movementLoanId: { state: true },
    editingMovement: { state: true },
    pendingEvidenceMovementId: { state: true },
    error: { state: true },
    editingAccount: { state: true },
    newAccountType: { state: true },
    formLimit: { state: true },
    formAvailable: { state: true },
    newMovementDefaults: { state: true },
    showCategoryForm: { state: true },
    categoryError: { state: true },
    categoryNotice: { state: true },
    createdCategory: { state: true },
    familyTransferData: { state: true },
    familyTransferLoading: { state: true },
    movementAmountError: { state: true },
  }

  constructor() {
    super()
    this.dashboard = null
    this.familyView = false
    this.familyAvailable = false
    this.familyError = ''
    this.activeTab = 'overview'
    this.selectedCard = null
    this.today = new Date()
    this.overviewPeriod = ''
    this.overviewScope = 'month'
    this.cardsListView = false
    this.plansListView = false
    this.loading = true
    this.submitting = false
    this.showAccountForm = false
    this.editingAccount = null
    this.newAccountType = ''
    this.formLimit = ''
    this.formAvailable = '0'
    this.formLimit = ''
    this.formAvailable = '0'
    this.showMovementForm = false
    this.newMovementDefaults = null
    this.showPlanForm = false
    this.editingPlan = null
    this.planUnit = ''
    this.selectedPlan = null
    this.pendingDeletePlan = null
    this.movementOperation = 'expense'
    this.movementMode = 'normal'
    this.movementLoanId = null
    this.editingMovement = null
    this.pendingEvidenceMovementId = null
    this.error = ''
    this.showCategoryForm = false
    this.categoryError = ''
    this.categoryNotice = ''
    this.createdCategory = null
    this.familyTransferData = null
    this.familyTransferLoading = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.loadDashboard()
    this.loadFamilyAvailability()
    this.cardClock = window.setInterval(() => { this.today = new Date() }, 60000)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.clearInterval(this.cardClock)
  }

  updated(changed) {
    if (this.showPlanForm && (changed.has('editingPlan') || changed.has('showPlanForm'))) {
      const form = this.renderRoot.querySelector('#plan-form')
      form?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      form?.querySelector('[name="startDate"]')?.focus({ preventScroll: true })
    }
    if (changed.has('showMovementForm')) {
      const dialog = this.renderRoot.querySelector('#movement-dialog')
      if (this.showMovementForm && dialog && !dialog.open) dialog.showModal()
      else if (!this.showMovementForm && dialog?.open) dialog.close()
    }
  }

  async loadDashboard() {
    const version = this.dashboardLoadVersion = (this.dashboardLoadVersion || 0) + 1
    this.loading = true
    this.error = ''
    try {
      await this.refreshDashboard()
    } catch (error) {
      if (version === this.dashboardLoadVersion) this.error = error.message
    } finally {
      if (version === this.dashboardLoadVersion) this.loading = false
    }
  }

  async loadFamilyAvailability() {
    this.familyError = ''
    try {
      const { family } = await apiRequest('/api/family')
      this.familyAvailable = Boolean(family)
    } catch (error) {
      this.familyError = `No se pudo consultar tu acceso familiar: ${error.message}`
    }
  }

  changeView(event) {
    if (this.submitting) return
    if (event.currentTarget.value === 'family' && !this.familyAvailable) return
    this.pendingEvidenceMovementId = null
    this.familyView = event.currentTarget.value === 'family'
    this.familyTransferData = null
    this.familyTransferLoading = false
    this.familyTransferRequest = (this.familyTransferRequest || 0) + 1
    this.dashboard = null
    this.selectedCard = null
    this.selectedPlan = null
    this.editingAccount = null
    this.editingPlan = null
    this.showAccountForm = false
    this.showPlanForm = false
    this.showMovementForm = false
    this.showCategoryForm = false
    this.pendingDeletePlan = null
    this.movementLoanId = null
    this.loadDashboard()
  }

  async handleSubscriptionsChanged() {
    this.error = ''
    try {
      await this.refreshDashboard()
    } catch (error) {
      this.error = `La suscripción se guardó, pero no se pudo actualizar el panorama: ${error.message}`
    }
  }

  render() {
    const tabs = [
      ['overview', 'Panorama'],
      ['movements', 'Movimiento'],
      ['cards', 'Tarjetas'],
      ['plans', 'Planes futuros'],
      ['subscriptions', 'Suscripciones'],
      ['debtors', 'Deudores'],
    ]
    const title = this.activeTab === 'accounts' ? 'Mis cuentas'
      : tabs.find(([id]) => id === this.activeTab)?.[1] || 'Panorama'

    return html`
      <main class="dashboard">
        <div class="finance-topbar">
        <button class="quiet-button back-to-menu" type="button" @click=${() => {
          this.dispatchEvent(new CustomEvent('back-to-menu', { bubbles: true, composed: true }))
        }}>← Menú principal</button>
        ${this.familyAvailable || this.familyView ? html`<button class="quiet-button scope-toggle" type="button"
          aria-label=${this.familyView ? 'Vista familiar. Cambiar a individual' : 'Vista individual. Cambiar a familiar'}
          title=${this.familyView ? 'Vista familiar · Consulta y movimientos especiales. Cambiar a individual' : 'Vista individual. Cambiar a familiar'}
          aria-pressed=${String(Boolean(this.familyView))} ?disabled=${this.submitting}
          @click=${() => this.changeView({ currentTarget: { value: this.familyView ? 'individual' : 'family' } })}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="7" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3" />
            ${this.familyView ? svg`<path d="M5 4a3 3 0 0 0 0 6M2 19v-3a4 4 0 0 1 3-4M19 4a3 3 0 0 1 0 6m3 9v-3a4 4 0 0 0-3-4" />` : ''}
          </svg>
        </button>` : ''}
        </div>
        ${this.familyError ? html`<div class="error-message" role="alert">${this.familyError}
          <button class="text-button" type="button" @click=${this.loadFamilyAvailability}>Reintentar consulta familiar</button>
        </div>` : ''}
        ${this.familyView ? html`<p class="family-view-notice" role="status">
          <strong>Vista familiar: consulta y movimientos especiales.</strong>
          En las tarjetas de otros integrantes puedes registrar un pago o transferencia desde tus cuentas con «Registrar movimiento especial».
          Para otros registros, editar o eliminar, cambia a Individual con el icono superior.
          Administra los integrantes y las invitaciones en Mi perfil → Mi familia.
        </p>` : ''}
        <div class="dashboard-heading">
          <div>
            <p class="eyebrow">SALUD FINANCIERA</p>
            <h1>${title}</h1>
            <p>${this.familyView ? `Consulta familiar${this.dashboard?.family ? ` · ${this.dashboard.family.name}` : ''}. Los nombres identifican al propietario de cada registro.`
              : 'La información que ves pertenece a tu usuario.'}</p>
          </div>
        </div>
        ${this.error ? html`<div class="error-message dashboard-error" role="alert">${this.error}</div>` : ''}
        <nav class="tabs" aria-label="Secciones financieras">
          ${tabs.map(([id, label]) => html`
            <button class=${this.activeTab === id ? 'tab active' : 'tab'} type="button"
              aria-current=${this.activeTab === id ? 'page' : 'false'}
              @click=${() => { this.activeTab = id; this.error = '' }}
            >${label}</button>
          `)}
        </nav>
        ${this.loading ? html`<p class="empty-state" role="status">Cargando información financiera…</p>`
            : this.dashboard ? keyed(this.familyView, this.renderActiveTab()) : html`
              <div class="empty-state">
                <p>No se pudo cargar tu información financiera.</p>
                <button class="quiet-button" type="button" @click=${this.loadDashboard}>Reintentar</button>
              </div>
            `}
        ${this.renderPlanDeleteDialog()}
        ${this.dashboard ? this.renderMovementDialog() : ''}
      </main>
    `
  }

  renderActiveTab() {
    switch (this.activeTab) {
      case 'cards': return this.renderCards()
      case 'accounts': return this.renderAccounts()
      case 'subscriptions': return html`<finance-subscriptions .familyView=${this.familyView}
        @subscriptions-changed=${this.handleSubscriptionsChanged}
        @register-subscription-movement=${(event) => this.startSubscriptionMovement(event.detail)}></finance-subscriptions>`
      case 'plans': return this.renderPlans()
      case 'movements': return this.renderMovements()
      case 'debtors': return this.renderDebtors()
      default: return this.renderOverview()
    }
  }

  renderDebtors() {
    return html`
      <finance-loans .items=${this.dashboard.loans || []} .accounts=${this.dashboard.accounts}
        .familyView=${this.familyView}
        @loans-changed=${this.loadDashboard}
        @loan-payment=${(event) => this.startLoanPayment(event.detail)}></finance-loans>
    `
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
          contribution: formData.get('contribution'),
          contributionDay: formData.get('contributionDay'),
          startDate: formData.get('startDate'),
          depositDetails: formData.get('depositDetails'),
          visible: formData.has('visible'),
        }),
      })
      this.showPlanForm = false
      this.editingPlan = null
      this.planUnit = ''
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async requestDeletePlan(plan) {
    this.pendingDeletePlan = plan
    this.error = ''
    await this.updateComplete
    this.renderRoot.querySelector('#delete-plan-dialog').showModal()
  }

  closePlanDeleteDialog() {
    if (this.submitting) return
    this.renderRoot.querySelector('#delete-plan-dialog').close()
    this.pendingDeletePlan = null
  }

  async handleDeletePlan() {
    const plan = this.pendingDeletePlan
    if (!plan || this.submitting) return
    this.error = ''
    this.submitting = true
    try {
      await apiRequest(`/api/plans/${plan.id}`, { method: 'DELETE' })
      if (this.editingPlan?.id === plan.id) {
        this.editingPlan = null
        this.showPlanForm = false
      }
      if (this.selectedPlan?.id === plan.id) this.selectedPlan = null
      this.renderRoot.querySelector('#delete-plan-dialog').close()
      this.pendingDeletePlan = null
      await this.refreshDashboard()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  renderPlanDeleteDialog() {
    return html`
      <dialog id="delete-plan-dialog" class="plan-delete-dialog" aria-labelledby="delete-plan-title"
        @cancel=${(event) => {
          if (this.submitting) event.preventDefault()
          else this.pendingDeletePlan = null
        }}>
        <h2 id="delete-plan-title">¿Eliminar el plan?</h2>
        <p>${this.pendingDeletePlan?.name}</p>
        <p>Solo se puede eliminar si no tiene movimientos relacionados. No se borrará su historial.</p>
        ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
        <div class="plan-delete-actions">
          <button class="quiet-button" type="button" autofocus ?disabled=${this.submitting}
            @click=${this.closePlanDeleteDialog}>Cancelar</button>
          <button class="primary-button confirm-plan-delete" type="button" ?disabled=${this.submitting}
            @click=${this.handleDeletePlan}>${this.submitting ? 'Eliminando…' : 'Sí, eliminar'}</button>
        </div>
      </dialog>
    `
  }

  startPlanMovement(plan) {
    this.pendingEvidenceMovementId = null
    this.error = ''
    this.editingMovement = null
    this.createdCategory = null
    this.movementOperation = 'expense'
    this.movementMode = 'investment'
    this.movementLoanId = null
    this.newMovementDefaults = { planId: plan.id, planName: plan.name }
    this.showMovementForm = true
    this.activeTab = 'movements'
  }

  startSubscriptionMovement(subscription) {
    if (this.familyView || this.submitting) return
    this.pendingEvidenceMovementId = null
    this.error = ''
    this.editingMovement = null
    this.createdCategory = null
    this.movementLoanId = null
    this.movementMode = 'subscription'
    this.movementOperation = 'expense'
    this.newMovementDefaults = {
      date: localDateInput(),
      amount: subscription.cost,
      subscriptionId: subscription.id,
      subscriptionName: subscription.name,
    }
    this.showMovementForm = true
    this.activeTab = 'movements'
  }

  startLoanPayment(loan) {
    this.pendingEvidenceMovementId = null
    this.error = ''
    this.editingMovement = null
    this.createdCategory = null
    this.movementLoanId = loan.id
    this.movementMode = 'loan'
    this.movementOperation = loan.type === 'me_deben' ? 'income' : 'expense'
    this.newMovementDefaults = {
      amount: loan.remaining,
      ...(loan.type === 'me_deben' ? { destinationAccountId: loan.accountId } : { originAccountId: loan.accountId }),
    }
    this.showMovementForm = true
  }

  async handleSaveMovement(event) {
    event.preventDefault()
    if (event.currentTarget.elements && !this.validateMovementAmount(event.currentTarget)) return
    this.error = ''
    this.submitting = true

    const formData = new FormData(event.currentTarget)
    const mode = this.movementMode || 'normal'
    if (this.familyView && mode !== 'family') {
      this.error = 'Desde la vista familiar solo puedes registrar movimientos especiales desde tus cuentas.'
      this.submitting = false
      return
    }
    const loan = (this.dashboard?.loans || []).find((item) => Number(item.id) === Number(this.movementLoanId))
    if (mode === 'loan' && !loan) {
      this.error = 'Selecciona un préstamo disponible antes de registrar el abono.'
      this.submitting = false
      return
    }
    if (mode === 'family' && (this.familyTransferLoading || !this.familyTransferData)) {
      this.error = 'Carga las cuentas de tu familia antes de guardar el movimiento.'
      this.submitting = false
      return
    }
    const operation = mode === 'family' ? 'transfer' : mode === 'loan' ? loan.type === 'me_deben' ? 'income' : 'expense'
      : mode === 'normal' ? this.movementOperation : 'expense'
    const payload = {
      operation,
      date: formData.get('date'),
      amount: formData.get('amount'),
      originAccountId: operation === 'income' ? null : formData.get('originAccountId') || null,
      destinationAccountId: operation === 'expense' ? null : formData.get('destinationAccountId') || null,
      categoryId: mode === 'normal' && operation !== 'transfer' ? formData.get('categoryId') || null : null,
      planId: mode === 'investment' ? formData.get('planId') || null : null,
      subscriptionId: mode === 'subscription' ? formData.get('subscriptionId') || null : null,
      ...(mode === 'loan' ? { loanId: this.movementLoanId, loanKind: 'abono' } : {}),
      ...(mode === 'family' ? { familyTransfer: true } : {}),
    }
    const editingId = this.pendingEvidenceMovementId || this.editingMovement?.id
    const evidence = this.renderRoot?.querySelector('#movement-evidence')
    if (evidence?.busy) {
      this.error = 'Espera a que termine la carga de imágenes antes de guardar el movimiento.'
      this.submitting = false
      return
    }
    let savedId

    try {
      const result = await apiRequest(editingId ? `/api/movements/${editingId}` : '/api/movements', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      savedId = result.id || editingId
      if (evidence?.pending.length) await evidence.uploadPending(savedId)
      this.showMovementForm = false
      this.pendingEvidenceMovementId = null
      this.editingMovement = null
      this.newMovementDefaults = null
      this.movementMode = 'normal'
      await this.refreshDashboard()
    } catch (error) {
      if (savedId && evidence?.pending.length) {
        // Keep the existing form and pending files so a retry never creates a second movement.
        this.pendingEvidenceMovementId = savedId
        this.error = `El movimiento #${savedId} ya se guardó, pero faltó subir evidencia: ${error.message}. Puedes reintentar sin duplicarlo.`
      } else {
        this.error = error.message
      }
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
    this.movementAmountError = ''
    if (movement.canEdit === false) {
      this.error = 'Solo quien envió el movimiento familiar puede editarlo o eliminarlo.'
      return
    }
    this.pendingEvidenceMovementId = null
    if (movement.loanKind === 'desembolso') {
      this.error = 'El desembolso inicial es fijo; sus abonos sí se pueden editar.'
      return
    }
    this.movementLoanId = movement.loanId || null
    this.movementMode = movement.recipientUserId ? 'family' : movement.loanId ? 'loan' : movement.planId ? 'investment'
      : movement.subscriptionId ? 'subscription' : 'normal'
    this.error = ''
    this.createdCategory = null
    this.newMovementDefaults = null
    this.movementOperation = movement.originAccountId && movement.destinationAccountId
      ? 'transfer'
      : movement.originAccountId ? 'expense' : 'income'
    this.editingMovement = {
      ...movement,
      amount: String(movement.amount),
    }
    this.showMovementForm = true
    if (movement.recipientUserId) this.loadFamilyTransferAccounts()
  }

  async refreshDashboard() {
    const version = this.dashboardRequestVersion = (this.dashboardRequestVersion || 0) + 1
    const data = await apiRequest(`/api/dashboard${this.familyView ? '?view=family' : ''}`)
    if (version === this.dashboardRequestVersion) this.dashboard = data
  }

  async handleCreateAccount(event) {
    event.preventDefault()
    this.error = ''
    this.submitting = true

    const formData = new FormData(event.currentTarget)
    const optionalNumber = (value) => value == null || value === '' ? null : value

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
          depositDetails: formData.get('depositDetails'),
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
    this.newAccountType = isCreditAccount(account.type) ? 'Tarjeta de crédito'
      : isDebitAccount(account.type) ? 'Tarjeta de débito' : isCashAccount(account.type) ? 'Efectivo' : ''
    this.formLimit = account.total ?? ''
    this.formAvailable = account.available
    this.showAccountForm = true
    this.activeTab = 'accounts'
  }

  startCardPayment(card) {
    this.pendingEvidenceMovementId = null
    this.movementLoanId = null
    this.movementMode = 'normal'
    this.movementOperation = 'transfer'
    this.editingMovement = null
    this.createdCategory = null
    this.newMovementDefaults = {
      destinationAccountId: card.id, cardName: card.name,
      amount: card.paymentToAvoidInterest ?? null,
    }
    this.showMovementForm = true
    this.activeTab = 'movements'
  }

  startCardCreation() {
    this.editingAccount = null
    this.newAccountType = ''
    this.formLimit = ''
    this.formAvailable = ''
    this.showAccountForm = true
    this.activeTab = 'accounts'
  }

  async handleConfirmCardPayment(card) {
    if (this.familyView || this.submitting) return
    const status = cardPaymentStatus(card, this.today)
    if (!status) return
    if (!window.confirm(status.manual
      ? `¿Retirar la confirmación manual del pago de "${card.name}"?`
      : `¿Confirmas que ya cubriste ${this.formatMoney(status.required)} de "${card.name}" con vencimiento ${this.formatDate(card.paymentDueDate)}? Esto no registra movimientos ni cambia saldos.`)) return
    this.error = ''
    this.submitting = true
    let saved = false
    try {
      await apiRequest(`/api/accounts/${card.id}/payment-confirmation`, {
        method: 'PUT',
        body: JSON.stringify({
          confirmed: !status.manual, paymentDueDate: card.paymentDueDate,
          paymentToAvoidInterest: card.paymentToAvoidInterest,
        }),
      })
      saved = true
      await this.refreshDashboard()
    } catch (error) {
      this.error = `${saved ? 'La confirmación se guardó, pero no se pudo actualizar el panorama: ' : ''}${error.message}`
    } finally {
      this.submitting = false
    }
  }

  renderOverview() {
    const { summary, accounts, subscriptions, plans, movements } = this.dashboard
    const period = this.overviewPeriod || `${this.today.getFullYear()}-${String(this.today.getMonth() + 1).padStart(2, '0')}`
    const totals = calculateAccountSummary(accounts, period, this.overviewScope, this.today)
    const activity = calculatePeriodActivity(this.dashboard.activityByMonth || [], period, this.overviewScope)
    const periodLabel = this.overviewScope === 'year' ? period.slice(0, 4) : period
    const payments = accounts.filter((account) => isCreditAccount(account.type))
      .map((account) => ({ account, status: cardPaymentStatus(account, this.today) }))
      .filter(({ status }) => status && status.period.startsWith(periodLabel))
    const metrics = [
      ['Saldo disponible', this.formatMoney(totals.available), 'Actual · Débito + efectivo', 'positive'],
      ['Disponible con crédito', this.formatMoney(totals.availableWithCredit), 'Actual · Débito + efectivo + crédito sin utilizar', 'transfer'],
      ['Deuda total', this.formatMoney(totals.debt), totals.missingLimits
        ? `Actual · ${totals.missingLimits} créditos sin límite: no incluidos` : 'Actual · Crédito utilizado', 'negative'],
      ['Pago para no generar intereses', this.formatMoney(totals.payment),
        `Pendiente del periodo ${periodLabel}`],
      ['Ingresos del periodo', this.formatMoney(activity.income), periodLabel, 'positive'],
      ['Gastos del periodo', this.formatMoney(activity.expenses), periodLabel, 'negative'],
      ['Inversión del periodo', this.formatMoney(activity.investment), 'Aportaciones a planes · ' + periodLabel, 'positive'],
      ['Suscripciones activas', summary.activeSubscriptionsCount, `${this.formatMoney(summary.monthlySubscriptionTotal)} al mes`],
      ['Planes futuros', summary.plansCount, 'Metas registradas'],
      ['Movimientos recientes', summary.movementsCount, 'Hasta 250 registros'],
    ]

    return html`
      <section class="data-card overview-period" aria-label="Periodo de consulta">
        <div class="section-heading">
          <h2>Panorama</h2>
          <div class="period-controls">
            <span class="period-selected" role="status">${this.overviewScope === 'year'
              ? `Año ${period.slice(0, 4)}` : new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`))}</span>
            ${this.renderOverviewPicker(period, 'month')}
            ${this.renderOverviewPicker(period, 'year')}
          </div>
          <button class="text-button" type="button" @click=${() => {
            this.overviewPeriod = ''
            this.overviewScope = 'month'
            this.overviewPickerYear = undefined
          }}>Mes actual</button>
        </div>
        <p class="form-hint">El periodo filtra ingresos, gastos, inversión en planes y pagos pendientes. Los vencimientos del día 1 al 14
          corresponden al mes anterior; lo pendiente se arrastra al mes actual. Saldos y deuda son actuales.
          Los pagos se descuentan con transferencias a la tarjeta desde el día siguiente al vencimiento anterior
          (un mes antes), incluso antes del corte, o con tu confirmación manual. Las aportaciones se muestran como inversión, no como gasto; transferencias y préstamos no cuentan como ingresos ni gastos.</p>
        ${totals.missingPayments ? html`<p class="form-hint">${totals.missingPayments} créditos sin fecha límite o importe de pago: no incluidos en el pago del periodo.</p>` : ''}
      </section>
      <section class="metric-grid" aria-label="Resumen">
        ${metrics.map(([label, value, detail, tone]) => html`
          <article class=${`metric-card${tone ? ` metric-${tone}` : ''}`}>
            <p>${label}</p>
            <strong>${value}</strong>
            <small>${detail}</small>
          </article>
        `)}
      </section>

      <section class="data-card overview-payments" aria-label="Pagos de tarjetas del periodo">
        <div class="section-heading"><h2>Pagos de tarjetas · ${periodLabel}</h2></div>
        <p class="form-hint">Importes del último corte capturado, no un historial de estados de cuenta.
          Si ya venció, el banco puede haber cambiado el importe: revísalo y actualiza la tarjeta.</p>
        ${payments.length ? html`<ul class="payment-list">
          ${payments.map(({ account, status }) => html`<li>
            <div class="payment-description"><strong>${account.name}</strong>
              ${renderCardImage(account.catalogName || account.name, account.type)}
              <span>Límite: ${this.formatDate(account.paymentDueDate)} · Importe: ${this.formatMoney(status.required)}</span>
              <span>Abonos detectados: ${this.formatMoney(status.paid)} · Pendiente: ${this.formatMoney(status.remaining)}</span>
              ${this.renderCardPaymentCountdown(account)}
            </div>
            <div class="payment-actions" ?hidden=${this.familyView}>
              ${status.remaining > 0 ? html`<button class="text-button" type="button" @click=${() => this.startCardPayment(account)}>Registrar abono</button>` : ''}
              <button class="text-button" type="button" ?disabled=${this.submitting}
                @click=${() => this.handleConfirmCardPayment(account)}>${status.manual ? 'Retirar confirmación manual' : 'Confirmar pago manualmente'}</button>
              ${status.overdue ? html`<button class="text-button" type="button" @click=${() => this.startAccountEdit(account)}>Revisar importe</button>` : ''}
            </div>
          </li>`)}
        </ul>` : this.emptyMessage('No hay pagos de tarjetas asignados a este periodo.')}
      </section>

      <div class="overview-grid">
        <section class="data-card">
          <div class="section-heading">
            <div><p class="eyebrow">TUS MEDIOS</p><h2>Cuentas</h2></div>
            <button class="text-button" type="button" @click=${() => { this.activeTab = 'accounts' }}>Ver todas →</button>
          </div>
          ${accounts.length
            ? html`<ul class="compact-list">${accounts.slice(0, 4).map((account) => html`
                <li><span><strong>${account.name}</strong>${renderCardImage(account.catalogName || account.name, account.type)}<small>${account.type}</small></span><b>${this.formatMoney(account.available)}</b></li>
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
      ${plans.some((plan) => Boolean(Number(plan.visible))) ? html`
        <section class="data-card overview-plans">
          <div class="section-heading">
            <h2>Planes futuros</h2>
            <button class="text-button" type="button" @click=${() => { this.activeTab = 'plans' }}>Ver todos →</button>
          </div>
          <ul class="overview-plan-list">
            ${plans.filter((plan) => Boolean(Number(plan.visible))).slice(0, 4).map((plan) => {
              const progress = Number(plan.goal) > 0
                ? Math.min(100, Math.max(0, Number(plan.saved) / Number(plan.goal) * 100)) : 0
              return html`
                <li>
                  <div class="overview-plan-heading">
                    <button class="text-button" type="button" @click=${() => {
                      this.activeTab = 'plans'
                      this.selectedPlan = plan
                    }}>${plan.name}</button>
                    ${renderCardImage(plan.catalogName || plan.name, 'plan')}
                    <span>${this.formatMoney(plan.saved)} / ${this.formatMoney(plan.goal)}</span>
                  </div>
                  <div class="overview-plan-progress">
                    <progress max="100" .value=${progress} aria-label=${`Progreso de ${plan.name}`}></progress>
                    <small>${Math.floor(progress)}%</small>
                  </div>
                </li>
              `
            })}
          </ul>
          ${plans.filter((plan) => Boolean(Number(plan.visible))).length > 4
            ? html`<p class="overview-footnote">Mostrando 4 planes. Consulta el resto en Planes futuros.</p>` : ''}
        </section>
      ` : ''}
      <p class="overview-footnote">${subscriptions.length} suscripciones · ${plans.length} planes futuros</p>
    `
  }

  selectOverviewPeriod(event, period, scope) {
    this.overviewPeriod = period
    this.overviewScope = scope
    event.currentTarget.closest('details').open = false
    event.currentTarget.closest('details').querySelector('summary').focus()
  }

  renderOverviewPicker(period, scope) {
    const annual = scope === 'year'
    const label = annual ? 'Seleccionar año' : 'Seleccionar mes'
    const year = this.overviewPickerYear ?? Number(period.slice(0, 4))
    const start = Math.min(9988, Math.max(1000, year - (year - 1000) % 12))
    const step = annual ? 12 : 1
    return html`<details class="period-picker" name="overview-period-picker"
      @toggle=${(event) => {
        if (event.currentTarget.open) this.overviewPickerYear = Number(period.slice(0, 4))
      }}
      @keydown=${(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false
          event.currentTarget.querySelector('summary').focus()
        }
      }}>
      <summary aria-label=${label} title=${label} class=${this.overviewScope === scope || (!this.overviewScope && !annual) ? 'active' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" />
          ${annual ? svg`<path d="M7 14h2m4 0h4M7 17h2m4 0h4" />` : svg`<rect x="7" y="14" width="4" height="3" rx=".5" />`}
        </svg>
      </summary>
      <div class="period-popup" role="group" aria-label=${annual ? 'Calendario de años' : 'Calendario de meses'}>
        <div class="period-popup-heading">
          <button class="quiet-button" type="button" aria-label=${annual ? 'Años anteriores' : 'Año anterior'}
            ?disabled=${annual ? start <= 1000 : year <= 1000}
            @click=${() => { this.overviewPickerYear = Math.max(1000, year - step) }}>‹</button>
          <strong>${annual ? `${start}–${start + 11}` : year}</strong>
          <button class="quiet-button" type="button" aria-label=${annual ? 'Años siguientes' : 'Año siguiente'}
            ?disabled=${annual ? start >= 9988 : year >= 9999}
            @click=${() => { this.overviewPickerYear = Math.min(9999, year + step) }}>›</button>
        </div>
        <div class="period-options">${Array.from({ length: 12 }, (_, index) => {
          const value = annual ? String(start + index) : `${year}-${String(index + 1).padStart(2, '0')}`
          const selected = annual ? period.slice(0, 4) === value : period === value
          const text = annual ? value : new Intl.DateTimeFormat('es-MX', { month: 'short', timeZone: 'UTC' })
            .format(new Date(Date.UTC(2026, index, 1)))
          return html`<button class="quiet-button" type="button" aria-pressed=${String(selected)}
            @click=${(event) => this.selectOverviewPeriod(event, annual ? `${value}-${period.slice(5, 7)}` : value, scope)}>${text}</button>`
        })}</div>
      </div>
    </details>`
  }

  renderAccounts() {
    const accounts = this.dashboard.accounts
    return html`
      <section class="data-card">
        <div class="section-heading">
          <div><p class="eyebrow">REGISTROS DE TU USUARIO</p><h2>Mis cuentas</h2></div>
          <button class="primary-button compact-button" type="button" ?hidden=${this.familyView} @click=${() => {
            this.showAccountForm = !this.showAccountForm
            this.editingAccount = null
            this.newAccountType = ''
            this.formLimit = ''
            this.formAvailable = '0'
          }}>
            ${this.showAccountForm ? 'Cancelar' : html`${addIcon()}Nueva cuenta`}
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
                  <td class="row-actions" ?hidden=${this.familyView}>
                    <button class="edit-button" type="button" aria-label=${`Editar ${account.name}`} title="Editar cuenta" @click=${() => {
                      this.startAccountEdit(account)
                    }}>${editIcon()}</button>
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
    const credit = isCreditAccount(this.newAccountType)
    const used = Math.round(Number(this.formLimit) * 100) - Math.round(Number(this.formAvailable) * 100)
    return html`
      <form class="account-form" @submit=${this.handleCreateAccount}>
        <label>Tipo de tarjeta o cuenta
          <select name="type" required @change=${(event) => { this.newAccountType = event.target.value }}>
            <option value="" .selected=${!this.newAccountType} disabled>Selecciona un tipo</option>
            <option value="Tarjeta de crédito" .selected=${credit}>Crédito</option>
            <option value="Tarjeta de débito" .selected=${isDebitAccount(this.newAccountType)}>Débito</option>
            <option value="Efectivo" .selected=${isCashAccount(this.newAccountType)}>Efectivo</option>
          </select>
        </label>
        ${this.newAccountType ? html`
        <label>Nombre de ${isCashAccount(this.newAccountType) ? 'la cuenta' : 'la tarjeta'}
          <input name="name" maxlength="100" placeholder="Cuenta principal" .value=${account.name || ''} required />
        </label>
        <label class="card-deposit"><span class="deposit-content"><span class="deposit-label">${isCashAccount(this.newAccountType) ? 'Datos de depósito (opcional)' : 'Número de cuenta o CLABE (opcional)'}</span>
          <input name="depositDetails" maxlength="500"
            placeholder="Banco, titular, cuenta, CLABE o referencia" .value=${account.depositDetails || ''} /></span><copy-deposit field></copy-deposit>
        </label>
        ${credit ? html`
          <label>Crédito total (límite máximo)
            <input name="total" type="number" min="0" step="0.01" .value=${String(this.formLimit)}
              @input=${(event) => { this.formLimit = event.target.value }} required />
          </label>
        ` : ''}
        <label>${credit ? 'Crédito disponible (sin utilizar)' : 'Saldo disponible'}
          <input name="available" type="number" min="0" step="0.01" .value=${String(this.formAvailable)}
            @input=${(event) => { this.formAvailable = event.target.value }} required />
        </label>
        ${credit ? html`
          <label>Saldo utilizado (deuda actual)
            <output>${this.formLimit === '' || this.formAvailable === '' ? 'Introduce crédito total y disponible' : used < 0
              ? 'El disponible no puede superar el límite' : this.formatMoney(used / 100)}</output>
          </label>
          <p class="form-hint">Se guardan el crédito total y el disponible por separado. Deuda total = crédito total − crédito disponible; no se captura ni se guarda como disponible.</p>
          <label>Fecha de corte<input name="statementDate" type="date" .value=${account.statementDate || ''} ?required=${credit} /></label>
          <label>Fecha límite de pago<input name="paymentDueDate" type="date" .value=${account.paymentDueDate || ''} ?required=${credit} /></label>
          <label>Pago para no generar intereses de este mes<input name="paymentToAvoidInterest" type="number" min="0" step="0.01" .value=${account.paymentToAvoidInterest ?? ''} ?required=${credit} /></label>
        ` : ''}
        <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>${this.editingAccount ? 'Guardar cambios' : 'Guardar cuenta'}</button></div>
        ` : ''}
      </form>
    `
  }

  renderCards() {
    const cards = sortByDue(this.dashboard.accounts.filter(isCardAccount), (card) => {
      if (!isCreditAccount(card.type)) return null
      const status = cardPaymentStatus(card, this.today)
      return status?.remaining > 0 ? status.days : null
    })
    const groups = [
      { title: 'Nómina / Débito / Efectivo', cards: cards.filter((card) => !isCreditAccount(card.type)) },
      { title: 'Crédito', cards: cards.filter((card) => isCreditAccount(card.type)) },
    ]
    return html`
      <section>
        <div class="section-heading viewer-heading">
          <h2>Mis tarjetas</h2>
          ${viewToggle(this.cardsListView, () => { this.cardsListView = !this.cardsListView })}
          <button class="primary-button compact-button" type="button" ?hidden=${this.familyView} @click=${this.startCardCreation}>${addIcon()}Nueva tarjeta</button>
        </div>
        <div class=${`card-type-columns${this.cardsListView ? ' list-groups' : ''}`}>
          ${groups.map((group) => html`
            <section class="card-type-group" aria-label=${group.title}>
              <h3 class="card-group-title">${group.title}</h3>
              ${group.cards.length ? html`
                <div class=${this.cardsListView ? 'record-list' : 'card-grid'}>${group.cards.map((card) => this.renderBankCard(card))}</div>
              ` : html`<p class="empty-state">No tienes tarjetas de ${group.title.toLowerCase()}.</p>`}
            </section>
          `)}
        </div>
        ${cards.some((card) => card.id === this.selectedCard?.id) ? html`
          <finance-related-movements relation="account"
            .familyView=${this.familyView} .relationId=${this.selectedCard.id} .label=${this.selectedCard.name}></finance-related-movements>
        ` : ''}
      </section>
    `
  }

  renderCreditProgress(card) {
    const total = Number(card.total)
    const available = Number(card.available)
    if (card.total == null || !Number.isFinite(total) || total <= 0 || !Number.isFinite(available)) {
      return html`<p class="credit-progress-note">Configura un límite mayor que cero para ver el porcentaje disponible.</p>`
    }
    const percentage = Math.max(0, Math.min(100, available / total * 100))
    const level = percentage > 50 ? 'healthy' : percentage > 20 ? 'moderate' : 'low'
    return html`
      <div class="credit-progress ${level}">
        <div class="credit-progress-label"><span>Crédito disponible</span><strong>${Math.round(percentage)}%</strong></div>
        <div class="credit-progress-track" role="progressbar" aria-label="Porcentaje de crédito disponible"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percentage}
          aria-valuetext=${`${this.formatMoney(available)} disponibles de ${this.formatMoney(total)}`}>
          <div class="credit-progress-fill" style=${`width: ${percentage}%`}></div>
        </div>
        <small>${this.formatMoney(available)} de ${this.formatMoney(total)}</small>
      </div>
    `
  }

  renderCardPaymentCountdown(card) {
    const status = cardPaymentStatus(card, this.today)
    if (status?.remaining === 0) {
      return html`<p class="card-payment-countdown paid" role="status"><strong>${status.manual
        ? 'Pago confirmado manualmente' : 'Pago cubierto con los abonos registrados'}</strong></p>`
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(card.paymentDueDate || ''))
    if (!match) return html`<p class="card-payment-countdown">Configura la fecha límite de pago.</p>`
    const due = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    const today = Date.UTC(this.today.getFullYear(), this.today.getMonth(), this.today.getDate())
    const days = Math.round((due - today) / 86400000)
    return html`
      <p class="card-payment-countdown ${days <= 2 ? 'urgent' : ''}" role="status">
        <strong>${days < 0 ? `⚠ Pago vencido hace ${Math.abs(days)} ${days === -1 ? 'día' : 'días'}. No se ha registrado el pago completo; revisa el nuevo pago para no generar intereses.`
          : days === 0 ? '⚠ ¡Hoy es el último día para pagar!'
            : days === 1 ? '⚠ Falta 1 día para pagar' : days === 2 ? '⚠ Faltan 2 días para pagar' : `Faltan ${days} días para pagar`}</strong>
      </p>
    `
  }

  renderBankCard(card) {
    return html`
                <article class=${`credit-card ${this.selectedCard?.id === card.id ? 'selected' : ''}`}
                  style=${accountThemeStyle(card)}
                  tabindex="0" aria-label=${`${card.name}. Mostrar movimientos`}
                  @keydown=${(event) => {
                    if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                      event.preventDefault()
                      this.selectedCard = card
                    }
                  }} @click=${(event) => {
                  if (!event.target.closest('button')) this.selectedCard = card
                }}>
                  <div class="credit-card-heading">
                    <span>${card.type}</span>
                  </div>
                  <h3>${card.name}</h3>
                  ${renderCardImage(card.catalogName || card.name, card.type)}
                  <div class="card-balances">
                    <div class="card-main-balance"><span>Saldo disponible</span><strong>${this.formatMoney(card.available)}</strong></div>
                    ${isCreditAccount(card.type) ? html`
                      <div><span>Límite máximo de crédito</span><strong>${card.total == null ? '—' : this.formatMoney(card.total)}</strong></div>
                      <div><span>Saldo utilizado</span><strong>${card.total == null ? '—'
                        : this.formatMoney((Math.round(Number(card.total) * 100) - Math.round(Number(card.available) * 100)) / 100)}</strong></div>
                    ` : ''}
                  </div>
                  ${isCreditAccount(card.type) ? html`
                    ${this.renderCreditProgress(card)}
                    ${this.renderCardPaymentCountdown(card)}
                  ` : ''}
                  ${isCreditAccount(card.type) ? html`<dl class="card-dates">
                    <div><dt>Fecha de corte</dt><dd>${this.formatDate(card.statementDate)}</dd></div>
                    <div><dt>Fecha límite de pago</dt><dd>${this.formatDate(card.paymentDueDate)}</dd></div>
                    <div class="card-payment">
                      <dt>Pago para no generar intereses de este mes</dt>
                      <dd>${card.paymentToAvoidInterest == null
                        ? '—'
                        : this.formatMoney(card.paymentToAvoidInterest)}</dd>
                    </div>
                  </dl>` : ''}
                  ${card.depositDetails ? renderDeposit(card.depositDetails) : ''}
                  ${this.familyView && card.ownerId != null && this.dashboard?.viewerId != null
                    && Number(card.ownerId) !== Number(this.dashboard.viewerId) ? html`
                    <div class="card-actions">
                      <button class="text-button" type="button" ?disabled=${this.submitting}
                        @click=${() => this.startFamilyMovement(card)}>Registrar movimiento especial</button>
                    </div>
                  ` : ''}
                  <div class="card-actions" ?hidden=${this.familyView}>
                    ${isCreditAccount(card.type) ? html`<button class="text-button" type="button" @click=${() => this.startCardPayment(card)}>Registrar pago</button>` : ''}
                    ${isCreditAccount(card.type) && cardPaymentStatus(card, this.today) ? html`
                      <button class="text-button" type="button" ?disabled=${this.submitting}
                        @click=${() => this.handleConfirmCardPayment(card)}>${cardPaymentStatus(card, this.today).manual
                          ? 'Retirar confirmación manual' : 'Confirmar pago manualmente'}</button>` : ''}
                    <button class="edit-button" type="button" aria-label=${`Editar tarjeta ${card.name}`} title="Editar tarjeta" @click=${() => this.startAccountEdit(card)}>${editIcon()}</button>
                    <button class="card-trash-button" type="button" aria-label=${`Eliminar ${card.name}`}
                      title="Eliminar tarjeta" @click=${() => this.handleDeleteAccount(card)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
                      </svg>
                    </button>
                  </div>
                </article>
    `
  }

  renderPlans() {
    const items = sortByDue(this.dashboard.plans, (plan) => {
      const projection = calculatePlanProjection(plan, this.today)
      return projection.nextContributionDate ? Date.parse(`${projection.nextContributionDate}T00:00:00Z`) : null
    })
    return html`
      <section class="data-card">
        <div class="section-heading viewer-heading">
          <div><p class="eyebrow">METAS FINANCIERAS</p><h2>Planes futuros</h2></div>
          ${viewToggle(this.plansListView, () => { this.plansListView = !this.plansListView })}
          <button class="primary-button compact-button" type="button" ?hidden=${this.familyView} @click=${() => {
            this.editingPlan = null
            this.planUnit = ''
            this.showPlanForm = !this.showPlanForm
          }}>
            ${this.showPlanForm ? 'Cancelar' : html`${addIcon()}Nuevo plan`}
          </button>
        </div>
        ${this.showPlanForm ? html`
          <form id="plan-form" class="module-form" @submit=${this.handleCreatePlan}>
            <h3 class="form-hint">${this.editingPlan ? `Editar plan: ${this.editingPlan.name}` : 'Nuevo plan'}</h3>
            <label>Fecha de inicio<input name="startDate" type="date" min="1000-01-01" max="9999-12-31"
              .value=${this.editingPlan?.startDate || ''} required />
              <small>Desde esta fecha se programan las aportaciones.</small>
            </label>
            <label>Nombre de la meta<input name="name" maxlength="100" .value=${this.editingPlan?.name || ''} required /></label>
            <label>Monto objetivo<input name="goal" type="number" min="0.01" step="0.01" .value=${this.editingPlan?.goal || ''} required /></label>
            <label>Unidad de periodo
              <select name="unitPeriod" required .value=${this.planUnit}
                @change=${(event) => { this.planUnit = event.currentTarget.value }}>
                <option value="" ?selected=${!['semana', 'mes'].includes(this.planUnit)}>Selecciona la frecuencia</option>
                <option value="semana" ?selected=${this.planUnit === 'semana'}>Semana</option>
                <option value="mes" ?selected=${this.planUnit === 'mes'}>Mes</option>
              </select>
            </label>
            <label>Aportación por periodo<input name="contribution" type="number" min="0.01" step="0.01" .value=${this.editingPlan?.contribution ?? ''} required /></label>
            ${this.planUnit === 'semana' ? html`
              <label>Día de aportación
                <select name="contributionDay" required>
                  <option value="">Selecciona un día</option>
                  ${weekdays.map((day, index) => html`<option value=${index + 1}
                    ?selected=${this.editingPlan?.periodUnit === 'semana' && Number(this.editingPlan.contributionDay) === index + 1}>${day}</option>`)}
                </select>
              </label>
            ` : html`
              <label>Día del mes de aportación<input name="contributionDay" type="number" min="1" max="31" step="1"
                .value=${this.editingPlan?.periodUnit === 'mes' ? this.editingPlan.contributionDay ?? '' : ''} required /></label>
            `}
            <label class="card-deposit"><span class="deposit-content"><span class="deposit-label">Datos de depósito (opcional)</span><input name="depositDetails" maxlength="500"
              placeholder="Banco, titular, cuenta, CLABE o referencia" .value=${this.editingPlan?.depositDetails || ''} /></span><copy-deposit field></copy-deposit></label>
            <label class="checkbox-label"><input name="visible" type="checkbox" ?checked=${this.editingPlan ? Boolean(Number(this.editingPlan.visible)) : true} /> Mostrar en el panorama</label>
            <p class="form-hint">Monetizado suma los movimientos vinculados al plan. Los periodos faltantes son el faltante dividido entre la aportación, redondeado hacia arriba. La fecha se estima con los próximos días de aportación y se recorre si quedan aportaciones pendientes; la meta no cambia. En meses cortos se usa su último día.</p>
            <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>${this.submitting ? 'Guardando…' : 'Guardar plan'}</button></div>
          </form>
        ` : ''}
        ${items.length
          ? html`<div class=${this.plansListView ? 'record-list' : 'card-grid'}>${items.map((item) => this.renderPlanCard(item))}</div>`
          : this.emptyMessage('No tienes planes futuros registrados.')}
        ${this.renderPlanMovements(items)}
      </section>
    `
  }

  renderPlanCard(plan) {
    const projection = calculatePlanProjection(plan, this.today)
    const progress = Number(plan.goal) > 0
      ? Math.min(100, Math.max(0, Number(plan.saved) / Number(plan.goal) * 100)) : 0
    const progressLabel = Math.floor(progress * 10) / 10
    const periodsLabel = plan.periodUnit === 'semana' ? 'Semanas faltantes'
      : plan.periodUnit === 'anio' ? 'Años faltantes' : 'Meses faltantes'
    return html`
      <article class="plan-card ${this.selectedPlan?.id === plan.id ? 'selected' : ''}" tabindex="0"
        aria-label=${`Plan ${plan.name}. Ver movimientos`}
        @click=${(event) => {
          if (!event.target.closest('button')) this.selectedPlan = plan
        }}
        @keydown=${(event) => {
          if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
            event.preventDefault()
            this.selectedPlan = plan
          }
        }}>
        <div class="credit-card-heading">
          <span>${plan.periodUnit === 'semana' ? 'Plan semanal' : plan.periodUnit === 'mes' ? 'Plan mensual' : plan.periodUnit === 'anio' ? 'Plan anual' : 'Plan sin configurar'}</span>
          <span class="status-tag ${projection.completed ? '' : 'pending'}">${projection.completed ? 'Meta completada' : 'En progreso'}</span>
        </div>
        <h3>${plan.name}</h3>
        ${renderCardImage(plan.catalogName || plan.name, 'plan')}
        ${this.renderPlanCountdown(projection)}
        <div class="card-balances">
          <div class="card-main-balance"><span>Monetizado</span><strong>${this.formatMoney(plan.saved)}</strong></div>
          <div><span>Meta fija</span><strong>${this.formatMoney(plan.goal)}</strong></div>
          <div><span>Faltante</span><strong>${this.formatMoney(plan.remaining)}</strong></div>
        </div>
        <div class="plan-progress">
          <div class="credit-progress-label"><span>Progreso</span><strong>${progressLabel}%</strong></div>
          <progress max="100" .value=${progress} aria-label=${`Progreso de ${plan.name}: ${progressLabel}%`}></progress>
        </div>
        ${projection.configured ? html`
          <dl class="card-dates">
            <div><dt>Fecha de inicio</dt><dd>${plan.startDate ? this.formatDate(plan.startDate) : 'Sin definir; configura al editar'}</dd></div>
            <div><dt>Aportación ${plan.periodUnit === 'semana' ? 'semanal' : 'mensual'}</dt><dd>${this.formatMoney(plan.contribution)}</dd></div>
            <div><dt>Día de aportación</dt><dd>${plan.periodUnit === 'semana' ? weekdays[Number(plan.contributionDay) - 1] : `Día ${plan.contributionDay} de cada mes`}</dd></div>
            <div><dt>${periodsLabel}</dt><dd>${projection.periodsRemaining}</dd></div>
            ${!projection.completed ? html`
              <div><dt>Próxima aportación</dt><dd>${projection.nextContributionDate ? this.formatDate(projection.nextContributionDate) : 'Fuera del rango de fechas'}</dd></div>
              <div class="card-payment"><dt>Finalización estimada</dt><dd>${projection.estimatedCompletionDate ? this.formatDate(projection.estimatedCompletionDate) : 'Fuera del rango de fechas; revisa la aportación'}</dd></div>
            ` : ''}
          </dl>
        ` : html`<p class="plan-note">Edita el plan para configurar la frecuencia semanal o mensual, el día y la aportación esperada.</p>`}
        ${!Number(plan.visible) ? html`<p class="plan-note">Oculto en el panorama</p>` : ''}
        ${plan.depositDetails ? renderDeposit(plan.depositDetails) : ''}
        <div class="card-actions" ?hidden=${this.familyView}>
          <button class="text-button" type="button" ?disabled=${this.submitting}
            @click=${() => this.startPlanMovement(plan)}>Registrar movimiento</button>
          <button class="edit-button" type="button" aria-label=${`Editar plan ${plan.name}`} title="Editar plan" @click=${() => {
            this.activeTab = 'plans'
            this.editingPlan = plan
            this.planUnit = ['semana', 'mes'].includes(plan.periodUnit) ? plan.periodUnit : ''
            this.showPlanForm = true
          }}>${editIcon()}</button>
          <button class="card-trash-button" type="button" ?disabled=${this.submitting}
            aria-label=${`Eliminar ${plan.name}`} title="Eliminar plan" @click=${() => this.requestDeletePlan(plan)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
            </svg>
          </button>
        </div>
      </article>
    `
  }

  renderPlanCountdown(projection) {
    if (projection.completed || !projection.nextContributionDate) return ''
    const today = Date.UTC(this.today.getFullYear(), this.today.getMonth(), this.today.getDate())
    const days = Math.round((Date.parse(`${projection.nextContributionDate}T00:00:00Z`) - today) / 86400000)
    return html`
      <div class="plan-countdown ${days <= 2 ? 'urgent' : ''} ${days === 0 ? 'today' : ''}" role="status">
        <strong>${days === 0 ? '¡Hoy es día de aportar!' : days === 1
          ? 'Falta 1 día para aportar' : `Faltan ${days} días para aportar`}</strong>
      </div>
    `
  }

  renderPlanMovements(plans) {
    const plan = plans.find((item) => item.id === this.selectedPlan?.id)
    return plan ? keyed(this.dashboard, html`
      <finance-related-movements relation="plan"
        .familyView=${this.familyView} .relationId=${plan.id} .label=${plan.name}></finance-related-movements>
    `) : ''
  }

  renderMovements() {
    return html`
      <section>
        <div class="section-heading">
          <div><p class="eyebrow">ACTIVIDAD MENSUAL</p><h2>Registro de movimientos</h2></div>
          <div class="movement-toolbar" ?hidden=${this.familyView}>
            <button class="quiet-button compact-button" type="button" @click=${() => {
              this.showCategoryForm = !this.showCategoryForm
              this.categoryError = ''
              this.categoryNotice = ''
            }}>${this.showCategoryForm ? 'Cerrar categorías' : html`${addIcon()}Registrar categoría`}</button>
            <button class="primary-button compact-button" type="button"
              @click=${() => this.openCalendarMovement({ date: localDateInput() })}>${addIcon()}Nuevo movimiento</button>
            ${this.familyAvailable ? html`<button class="quiet-button compact-button" type="button"
              @click=${this.startFamilyMovement}>${addIcon()}Movimiento familiar</button>` : ''}
          </div>
        </div>
        ${this.showCategoryForm && !this.showMovementForm ? this.renderCategoryForm() : ''}
        <financial-calendar .familyView=${this.familyView} .revision=${this.dashboard}
          @register-movement=${(event) => this.openCalendarMovement(event.detail)}
          @edit-movement=${(event) => this.startMovementEdit(event.detail)}
          @delete-movement=${(event) => this.handleDeleteMovement(event.detail.id)}></financial-calendar>
      </section>
    `
  }

  openCalendarMovement({ date, event = null }) {
    this.movementAmountError = ''
    this.pendingEvidenceMovementId = null
    if (event?.kind === 'loan') {
      const loan = this.dashboard.loans.find((item) => Number(item.id) === Number(event.loanId))
      if (!loan) {
        this.error = 'El préstamo ya no está disponible. Actualiza la información antes de registrar el abono.'
        return
      }
      this.startLoanPayment(loan)
      this.newMovementDefaults = { ...this.newMovementDefaults, date }
      return
    }
    this.movementLoanId = null
    this.movementMode = event?.kind === 'plan' ? 'investment'
      : event?.kind === 'subscription' ? 'subscription' : 'normal'
    this.error = ''
    this.createdCategory = null
    this.editingMovement = null
    this.movementOperation = event?.kind === 'card' ? 'transfer' : 'expense'
    this.newMovementDefaults = {
      date,
      planId: event?.planId,
      subscriptionId: event?.subscriptionId,
      destinationAccountId: event?.destinationAccountId,
      amount: event?.amount,
      planName: event?.kind === 'plan' ? event.label : null,
      cardName: event?.kind === 'card' ? event.label : null,
    }
    this.showMovementForm = true
  }

  async closeMovementDialog() {
    if (this.submitting) return
    if (this.renderRoot?.querySelector('#movement-evidence')?.busy) {
      this.error = 'Espera a que termine la carga de imágenes antes de cerrar.'
      return
    }
    const savedId = this.pendingEvidenceMovementId
    this.familyTransferRequest = (this.familyTransferRequest || 0) + 1
    this.familyTransferData = null
    this.familyTransferLoading = false
    this.showMovementForm = false
    this.pendingEvidenceMovementId = null
    this.editingMovement = null
    this.newMovementDefaults = null
    this.createdCategory = null
    this.movementLoanId = null
    this.movementMode = 'normal'
    if (savedId) {
      this.error = ''
      try {
        await this.refreshDashboard()
      } catch (error) {
        this.error = `El movimiento #${savedId} está guardado, pero no se pudo actualizar el panorama: ${error.message}`
      }
    }
  }

  renderMovementDialog() {
    return html`
      <dialog id="movement-dialog" class="movement-dialog" aria-labelledby="movement-dialog-title"
        @cancel=${(event) => {
          event.preventDefault()
          this.closeMovementDialog()
        }}>
        <div class="section-heading">
          <h2 id="movement-dialog-title">${this.editingMovement ? 'Editar movimiento' : 'Registrar movimiento'}</h2>
          <button class="quiet-button compact-button" type="button" ?disabled=${this.submitting}
            @click=${this.closeMovementDialog}>Cerrar</button>
        </div>
        ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
        ${this.showMovementForm ? keyed(this.editingMovement?.id ?? this.newMovementDefaults ?? 'new', this.renderMovementForm()) : ''}
        ${(!this.movementMode || this.movementMode === 'normal') ? html`<button class="text-button" type="button" @click=${() => {
          this.showCategoryForm = !this.showCategoryForm
          this.categoryError = ''
          this.categoryNotice = ''
        }}>${this.showCategoryForm ? 'Cerrar categorías' : html`${addIcon()}Registrar categoría`}</button>
        ${this.showCategoryForm ? this.renderCategoryForm() : ''}` : ''}
      </dialog>
    `
  }

  async handleCreateCategory(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    this.submitting = true
    this.categoryError = ''
    this.categoryNotice = ''
    try {
      const { category } = await apiRequest('/api/categories', {
        method: 'POST', body: JSON.stringify({ name: data.get('name'), type: data.get('type') }),
      })
      this.dashboard = {
        ...this.dashboard,
        categories: [...this.dashboard.categories, category]
          .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'es')),
      }
      this.createdCategory = category
      this.categoryNotice = `Categoría «${category.name}» registrada.`
      form.reset()
    } catch (error) {
      this.categoryError = error.message
    } finally {
      this.submitting = false
    }
  }

  renderCategoryForm() {
    return html`
      <section class="category-panel">
        <h3>Registrar categoría</h3>
        <p class="form-hint">Las categorías de ingreso y gasto son compartidas por la aplicación; no son exclusivas de tu usuario.</p>
        ${this.categoryError ? html`<p class="error-message" role="alert">${this.categoryError}</p>` : ''}
        ${this.categoryNotice ? html`<p class="success-message" role="status">${this.categoryNotice}</p>` : ''}
        <form class="module-form" @submit=${this.handleCreateCategory}>
          <label>Nombre de categoría<input name="name" maxlength="100" required /></label>
          <label>Tipo<select name="type" required>
            <option value="gasto" ?selected=${this.movementOperation !== 'income'}>Gasto</option>
            <option value="ingreso" ?selected=${this.movementOperation === 'income'}>Ingreso</option>
          </select></label>
          <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.submitting}>${this.submitting ? 'Guardando…' : 'Guardar categoría'}</button></div>
        </form>
      </section>
    `
  }

  startFamilyMovement(card = null) {
    if ((!this.familyView && !this.familyAvailable) || this.submitting) return
    const destination = card?.id ? card : null
    if (destination && Number(destination.ownerId) === Number(this.dashboard?.viewerId)) return
    this.openCalendarMovement({
      date: localDateInput(),
      event: destination ? {
        kind: 'card', destinationAccountId: destination.id, label: destination.name,
        amount: this.familyPaymentAmount(destination),
      } : null,
    })
    this.selectMovementMode({ currentTarget: { value: 'family', checked: true } })
  }

  familyUsedBalance(account) {
    return account.total == null ? null
      : Math.max(0, Math.round(Number(account.total) * 100) - Math.round(Number(account.available) * 100)) / 100
  }

  familyPaymentAmount(account) {
    if (!isCreditAccount(account.type)) return null
    return Number(account.paymentToAvoidInterest) > 0
      ? account.paymentToAvoidInterest : this.familyUsedBalance(account)
  }

  selectFamilyDestination(event) {
    const account = this.familyTransferData.accounts.find((account) => Number(account.id) === Number(event.currentTarget.value))
    if (!account) return
    const amountInput = event.currentTarget.form?.elements.namedItem('amount')
    if (amountInput) amountInput.value = this.familyPaymentAmount(account) ?? ''
    if (event.currentTarget.form?.elements.namedItem('originAccountId')) this.validateMovementAmount(event.currentTarget.form)
  }

  movementAvailable(account) {
    const movement = this.editingMovement
    let cents = Math.round(Number(account.available) * 100)
    if (movement && Number(movement.originAccountId) === Number(account.id)) cents += Math.round(Number(movement.amount) * 100)
    if (movement && Number(movement.destinationAccountId) === Number(account.id)) cents -= Math.round(Number(movement.amount) * 100)
    return Math.max(0, cents) / 100
  }

  movementCanFund(account) {
    return (isMoneyAccount(account.type) || (this.movementMode === 'subscription' && isCreditAccount(account.type)))
      && this.movementAvailable(account) > 0
  }

  validateMovementAmount(form) {
    const input = form.elements.namedItem('amount')
    if (!input) return true
    const originId = form.elements.namedItem('originAccountId')?.value
    const accounts = this.movementMode === 'family' ? this.familyTransferData?.accounts : this.dashboard.accounts
    const account = this.movementOperation !== 'income' && accounts?.find((account) => Number(account.id) === Number(originId))
    const available = account ? this.movementAvailable(account) : null
    if (available == null) input.removeAttribute('max')
    else input.max = available.toFixed(2)
    if (available != null && input.value !== '' && Math.round(Number(input.value) * 100) > Math.round(available * 100)) {
      input.value = ''
      this.movementAmountError = `No cuentas con dinero suficiente. Te pasaste del disponible de ${this.formatMoney(available)}. Ingresa otro monto.`
      input.setCustomValidity(this.movementAmountError)
      return false
    }
    if (input.value !== '' || !account) {
      this.movementAmountError = ''
      input.setCustomValidity('')
    }
    return !this.movementAmountError
  }

  selectMovementAccount(event) {
    if (this.movementMode === 'family' && event.currentTarget.name === 'destinationAccountId') {
      this.selectFamilyDestination(event)
    } else this.validateMovementAmount(event.currentTarget.form)
  }

  async loadFamilyTransferAccounts() {
    const version = this.familyTransferRequest = (this.familyTransferRequest || 0) + 1
    this.familyTransferData = null
    this.familyTransferLoading = true
    this.error = ''
    try {
      const data = await apiRequest('/api/family-transfer-accounts')
      if (version === this.familyTransferRequest) this.familyTransferData = data
    } catch (error) {
      if (version === this.familyTransferRequest) this.error = `No se pudieron cargar las cuentas familiares: ${error.message}`
    } finally {
      if (version === this.familyTransferRequest) this.familyTransferLoading = false
    }
  }

  renderFamilyAccountOptions(accounts, field, selectedId) {
    return html`<div class="family-account-options">${accounts.map((account) => html`
      <label class="family-account-option" style=${accountThemeStyle(account)}>
        <input type="radio" name=${field} value=${account.id}
          @change=${this.selectMovementAccount}
          .checked=${Number(selectedId) === Number(account.id)} required />
        <span><strong>${account.name}</strong><small>${account.ownerName ? `${account.ownerName} · ` : ''}${account.type}</small>
          ${renderCardImage(account.catalogName || account.name, account.type)}
          <small>Disponible: ${this.formatMoney(field === 'originAccountId' ? this.movementAvailable(account) : account.available)}</small>
          ${isCreditAccount(account.type) ? html`
            <small>Saldo utilizado: ${this.familyUsedBalance(account) == null ? 'Sin configurar' : this.formatMoney(this.familyUsedBalance(account))}</small>
            <small>Pago para no generar intereses: ${account.paymentToAvoidInterest == null ? 'Sin configurar' : this.formatMoney(account.paymentToAvoidInterest)}</small>
          ` : ''}
        </span>
      </label>
    `)}</div>`
  }

  selectMovementMode(event) {
    const mode = event.currentTarget.value
    if (!['normal', 'loan', 'subscription', 'investment', 'family'].includes(mode)) return
    if (this.familyView && mode !== 'family') return
    if (mode === 'family' && !this.familyView && !this.familyAvailable && !this.editingMovement?.recipientUserId) return
    if (!event.currentTarget.checked) {
      event.currentTarget.checked = true
      return
    }
    this.movementMode = mode
    this.movementAmountError = ''
    const amountInput = this.renderRoot?.querySelector('[name="amount"]')
    if (amountInput) {
      amountInput.setCustomValidity('')
      amountInput.removeAttribute('max')
    }
    this.movementLoanId = null
    if (mode !== 'normal') this.movementOperation = mode === 'family' ? 'transfer' : 'expense'
    if (mode === 'family') this.loadFamilyTransferAccounts()
    else {
      this.familyTransferRequest = (this.familyTransferRequest || 0) + 1
      this.familyTransferData = null
      this.familyTransferLoading = false
    }
  }

  selectMovementLoan(event) {
    const id = Number(event.currentTarget.value)
    const loan = (this.dashboard.loans || []).find((item) => Number(item.id) === id)
    this.movementLoanId = loan?.id || null
    this.movementOperation = loan?.type === 'me_deben' ? 'income' : 'expense'
  }

  renderMovementForm() {
    const movement = this.editingMovement || {}
    const mode = this.movementMode || 'normal'
    const planId = movement.planId || (!this.editingMovement ? this.newMovementDefaults?.planId : null)
    const subscriptionId = movement.subscriptionId || (!this.editingMovement ? this.newMovementDefaults?.subscriptionId : null)
    const categoryId = this.createdCategory?.type === (this.movementOperation === 'income' ? 'ingreso' : 'gasto')
      ? this.createdCategory.id : movement.categoryId
    const originAccountId = movement.originAccountId || this.newMovementDefaults?.originAccountId
    const destinationAccountId = movement.destinationAccountId
      || this.newMovementDefaults?.destinationAccountId
    const categories = this.dashboard.categories.filter((category) => {
      if (this.movementOperation === 'transfer') return false
      return category.type === (this.movementOperation === 'income' ? 'ingreso' : 'gasto')
    })
    const accounts = this.dashboard.accounts
    const originAccounts = accounts.filter((account) => this.movementCanFund(account))
    const loan = mode === 'loan'
      ? (this.dashboard.loans || []).find((item) => Number(item.id) === Number(this.movementLoanId)) : null

    return html`
      <form class="movement-form" @submit=${this.handleSaveMovement}>
        ${mode === 'normal' && this.newMovementDefaults?.cardName
          ? html`<p class="form-hint">Registra una transferencia hacia ${this.newMovementDefaults.cardName} para reflejar el pago en el saldo disponible.
            ${this.newMovementDefaults.amount != null ? 'El monto sugerido es el pago para no generar intereses; puedes ajustarlo antes de guardar.' : ''}</p>`
          : ''}
        ${mode === 'investment' && this.newMovementDefaults?.planName
          ? html`<p class="form-hint">Registra una aportación para ${this.newMovementDefaults.planName}; se descontará de la cuenta de origen y se sumará al monetizado del plan.</p>`
          : ''}
        ${mode === 'subscription' && this.newMovementDefaults?.subscriptionName
          ? html`<p class="form-hint">Registra un gasto para ${this.newMovementDefaults.subscriptionName}. El monto sugerido es su costo por cobro; puedes ajustarlo antes de guardar.</p>`
          : ''}
        ${loan ? html`<p class="form-hint">Abono a ${loan.name}. Pendiente: ${this.formatMoney(loan.remaining)}.
          ${loan.type === 'me_deben' ? 'El dinero regresará a tu cuenta.' : 'El dinero saldrá de tu cuenta para pagar la deuda.'}</p>` : ''}
        <fieldset class="movement-mode">
          <legend>Tipo de registro (elige uno)</legend>
          ${[
            ['normal', 'Registro normal'],
            ['loan', 'Abono a préstamo (opcional)'],
            ['subscription', 'Suscripción relacionada (opcional)'],
            ['investment', 'Aportación a plan (opcional) · Inversión'],
            ...(this.familyView || this.familyAvailable || movement.recipientUserId ? [['family', 'Movimiento familiar · Pago o transferencia']] : []),
          ].filter(([value]) => !this.familyView || value === 'family').map(([value, label]) => html`<label><input type="checkbox" name="movementMode"
            value=${value} .checked=${mode === value} @change=${this.selectMovementMode} />${label}</label>`)}
        </fieldset>
        ${mode === 'normal' ? html`<label>Operación
          <select
            name="operation"
            .value=${this.movementOperation}
            @change=${(event) => { this.movementOperation = event.currentTarget.value; this.movementLoanId = null }}
          >
            <option value="expense">Gasto</option>
            <option value="income" ?selected=${this.movementOperation === 'income'}>Ingreso</option>
            <option value="transfer" ?selected=${this.movementOperation === 'transfer'}>Transferencia</option>
          </select>
        </label>` : html`<p class="form-hint">Operación fija: ${mode === 'family' ? 'Transferencia familiar. Se descuenta de tu cuenta y se abona a la cuenta o tarjeta de tu familiar; no duplica gastos ni ingresos.'
          : mode === 'loan' && loan?.type === 'me_deben' ? 'Ingreso (cobro de préstamo)' : 'Gasto (salida de cuenta)'}.</p>`}
        ${mode === 'family' ? html`
          <p class="form-hint">Al seleccionar una tarjeta de destino, el monto se completa con el pago para no generar intereses.
            Si está en cero o sin configurar, se usa la deuda actual (saldo utilizado). Puedes ajustar el monto antes de guardar.</p>
          ${this.familyTransferLoading ? html`<p class="form-hint" role="status">Cargando cuentas familiares…</p>`
            : !this.familyTransferData ? html`<button class="quiet-button" type="button" @click=${this.loadFamilyTransferAccounts}>Reintentar cargar cuentas</button>` : html`
              <fieldset class="family-account-picker"><legend>Cuenta de origen · Tus cuentas</legend>
                ${this.renderFamilyAccountOptions(this.familyTransferData.accounts.filter((account) =>
                  Number(account.ownerId) === Number(this.familyTransferData.userId) && this.movementCanFund(account)), 'originAccountId', originAccountId)}
                ${!this.familyTransferData.accounts.some((account) => Number(account.ownerId) === Number(this.familyTransferData.userId) && this.movementCanFund(account))
                  ? html`<p class="form-hint">No hay cuentas propias de débito, nómina o efectivo con saldo disponible.</p>` : ''}
              </fieldset>
              <fieldset class="family-account-picker"><legend>Cuenta de destino · Tu familia</legend>
                ${this.renderFamilyAccountOptions(this.familyTransferData.accounts.filter((account) =>
                  Number(account.ownerId) !== Number(this.familyTransferData.userId)), 'destinationAccountId', destinationAccountId)}
                ${!this.familyTransferData.accounts.some((account) => Number(account.ownerId) !== Number(this.familyTransferData.userId))
                  ? html`<p class="form-hint">No hay cuentas de otros integrantes disponibles.</p>` : ''}
              </fieldset>
            `}
        ` : ''}
        ${mode === 'loan' ? html`
          <label>Abono a préstamo (opcional)
            <select name="loanId" required .value=${String(this.movementLoanId || '')} @change=${this.selectMovementLoan}>
              <option value="" ?selected=${!this.movementLoanId}>Selecciona un préstamo</option>
              ${(this.dashboard.loans || []).filter((item) =>
                (Number(item.remaining) > 0 || item.id === movement.loanId)
              ).map((item) => html`<option value=${item.id} ?selected=${Number(this.movementLoanId) === Number(item.id)}>${item.name} · ${this.formatMoney(item.remaining)} pendiente</option>`)}
            </select>
          </label>
        ` : ''}
        ${mode === 'subscription' ? html`<label>Suscripción relacionada
          <select name="subscriptionId" required .value=${String(subscriptionId || '')}>
            <option value="" ?selected=${!subscriptionId}>Selecciona una suscripción</option>
            ${this.dashboard.subscriptions.map((subscription) => html`<option value=${subscription.id} ?selected=${Number(subscriptionId) === Number(subscription.id)}>${subscription.name}</option>`)}
          </select>
        </label>` : ''}
        ${mode === 'investment' ? html`<label>Aportación a plan · Inversión
          <select name="planId" required .value=${String(planId || '')}>
            <option value="" ?selected=${!planId}>Selecciona un plan</option>
            ${this.dashboard.plans.map((plan) => html`<option value=${plan.id} ?selected=${Number(planId) === Number(plan.id)}>${plan.name}</option>`)}
          </select>
        </label>` : ''}
        <label>Fecha<input name="date" type="date" .value=${movement.date || this.newMovementDefaults?.date || localDateInput()} required /></label>
        <label>Monto<input name="amount" type="number" min="0.01" step="0.01" .value=${movement.amount ?? this.newMovementDefaults?.amount ?? ''} required
          class=${this.movementAmountError ? 'amount-invalid' : ''}
          aria-invalid=${this.movementAmountError ? 'true' : 'false'} aria-describedby="movement-amount-error"
          @input=${(event) => this.validateMovementAmount(event.currentTarget.form)} />
          <span id="movement-amount-error" class="amount-error" role="alert">${this.movementAmountError || ''}</span>
        </label>
        ${mode !== 'family' && this.movementOperation !== 'income' ? html`
          <fieldset class="family-account-picker"><legend>Cuenta de origen</legend>
            ${this.renderFamilyAccountOptions(originAccounts, 'originAccountId', originAccountId)}
            ${!originAccounts.length ? html`<p class="form-hint">No hay cuentas compatibles con saldo disponible.</p>` : ''}
          </fieldset>
        ` : ''}
        ${mode !== 'family' && this.movementOperation !== 'expense' ? html`
          <fieldset class="family-account-picker"><legend>Cuenta de destino</legend>
            ${this.renderFamilyAccountOptions(accounts, 'destinationAccountId', destinationAccountId)}
          </fieldset>
        ` : ''}
        ${mode === 'normal' && this.movementOperation !== 'transfer' ? html`
          <label>Categoría
            <select name="categoryId" .value=${String(categoryId || '')}>
              <option value="" ?selected=${!categoryId}>Sin categoría</option>
              ${categories.map((category) => html`<option value=${category.id} ?selected=${Number(categoryId) === Number(category.id)}>${category.name}</option>`)}
            </select>
          </label>
        ` : ''}
        <movement-evidence id="movement-evidence" class="form-hint"
          .movementId=${this.pendingEvidenceMovementId || movement.id || null} .expanded=${true}
          .hideToggle=${true} .locked=${this.submitting}></movement-evidence>
        <div class="form-actions">
          <button class="primary-button compact-button" ?disabled=${this.submitting
            || (mode !== 'family' && this.movementOperation !== 'income' && !originAccounts.length)
            || (mode === 'family' &&
            (this.familyTransferLoading || !this.familyTransferData
              || !this.familyTransferData.accounts.some((account) => Number(account.ownerId) === Number(this.familyTransferData.userId) && this.movementCanFund(account))
              || !this.familyTransferData.accounts.some((account) => Number(account.ownerId) !== Number(this.familyTransferData.userId))))}>
            ${this.submitting ? 'Guardando…' : this.editingMovement ? 'Guardar cambios' : 'Registrar movimiento'}
          </button>
        </div>
      </form>
    `
  }

  renderMovementList(items, actions = false) {
    return html`<ul class="movement-list">${items.map((item) => {
      const isTransfer = item.loanId || (item.originAccount && item.destinationAccount)
      const isIncome = !item.archivedFamily && !item.loanId && (item.categoryType === 'ingreso' ||
        (!item.originAccountId && Boolean(item.destinationAccountId)))
      return html`
        <li>
          <span class="movement-mark ${isIncome ? 'income' : isTransfer ? 'transfer' : 'expense'}">${isIncome ? '+' : isTransfer ? '↔' : '−'}</span>
          <span class="movement-description">
            <strong>${item.loanId || item.archivedFamily ? movementLabel(item) : item.category || item.planName || item.subscriptionName || 'Movimiento'}</strong>
            <small>${item.loanId ? `${movementOrigin(item)} → ${movementDestination(item)}` : item.originAccount && item.destinationAccount
              ? `${item.originAccount} → ${item.destinationAccount}`
              : item.originAccount || item.destinationAccount || item.planName || item.subscriptionName || 'Sin cuenta relacionada'}</small>
          </span>
          <span class="movement-amount">
            <strong>${this.formatMoney(item.amount)}</strong>
            <small>${this.formatDate(item.date)}</small>
          </span>
          ${actions && !this.familyView && item.canEdit !== false ? html`
            <span class="movement-actions">
              <button class="edit-button" type="button" aria-label=${`Editar movimiento ${item.id}`} title="Editar movimiento" @click=${() => this.startMovementEdit(item)}>${editIcon()}</button>
              <button class="text-button delete-button" type="button" @click=${() => this.handleDeleteMovement(item.id)} aria-label="Eliminar movimiento">×</button>
            </span>
          ` : ''}
          <movement-evidence .movementId=${item.id} .hasEvidence=${Boolean(item.hasEvidence)}
            .readOnly=${this.familyView || item.canEdit === false}></movement-evidence>
        </li>
      `
    })}</ul>`
  }

  emptyMessage(message) {
    return html`<p class="empty-state">${message}</p>`
  }
}

customElements.define('salud-financiera', SaludFinanciera)
