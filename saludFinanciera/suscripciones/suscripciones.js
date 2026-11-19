import { LitElement, html, unsafeCSS } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import '../frontend/related-movements.js'
import { apiRequest } from '../../src/api.js'
import sharedStyles from '../../src/inicio/styles.css?inline'
import financeStyles from '../frontend/styles.css?inline'
import responsiveStyles from '../frontend/responsive.css?inline'
import styles from './styles.css?inline'
import { calculateCosts, daysUntilBilling, frequencies, isWeekly, weekdays } from './calculations.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

class Subscriptions extends LitElement {
  static styles = [unsafeCSS(sharedStyles), unsafeCSS(financeStyles), unsafeCSS(responsiveStyles), unsafeCSS(styles)]
  static properties = {
    items: { state: true },
    familyView: { type: Boolean },
    loading: { state: true },
    submitting: { state: true },
    showForm: { state: true },
    editing: { state: true },
    error: { state: true },
    notice: { state: true },
    formFrequency: { state: true },
    formCost: { state: true },
    today: { state: true },
    pendingDelete: { state: true },
    selectedSubscription: { state: true },
  }

  constructor() {
    super()
    this.items = []
    this.loading = true
    this.submitting = false
    this.showForm = false
    this.editing = null
    this.error = ''
    this.notice = ''
    this.formFrequency = 'Mensual'
    this.formCost = ''
    this.today = new Date()
    this.pendingDelete = null
    this.selectedSubscription = null
  }

  connectedCallback() {
    super.connectedCallback()
    this.clock = window.setInterval(() => { this.today = new Date() }, 60000)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.clearInterval(this.clock)
  }

  updated(changed) {
    if (changed.has('familyView') || !this.started) {
      this.started = true
      this.load()
    }
    if (this.showForm && (changed.has('editing') || changed.has('showForm'))) {
      const form = this.renderRoot.querySelector('#subscription-form')
      form?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      form?.querySelector('[name="startDate"]')?.focus({ preventScroll: true })
    }
  }

  async load() {
    this.loading = true
    this.error = ''
    try {
      await this.refresh()
    } catch (error) {
      this.error = error.message
    } finally {
      this.loading = false
    }
  }

  async refresh() {
    const version = this.requestVersion = (this.requestVersion || 0) + 1
    const { subscriptions } = await apiRequest(`/api/subscriptions${this.familyView ? '?view=family' : ''}`)
    if (version === this.requestVersion) this.items = subscriptions
  }

  notifyChange() {
    this.dispatchEvent(new CustomEvent('subscriptions-changed', { bubbles: true, composed: true }))
  }

  openForm(item = null) {
    this.editing = item
    this.showForm = true
    this.error = ''
    this.notice = ''
    this.formFrequency = item?.frequency || 'Mensual'
    this.formCost = item?.cost ?? ''
  }

  async save(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = this.editing?.id
    this.submitting = true
    this.error = ''
    this.notice = ''
    try {
      const { subscription } = await apiRequest(id ? `/api/subscriptions/${id}` : '/api/subscriptions', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          cost: data.get('cost'),
          frequency: data.get('frequency'),
          type: data.get('type'),
          billingDay: data.get('billingDay') || null,
          paymentType: data.get('paymentType') || null,
          status: data.get('status'),
          startDate: data.get('startDate'),
          depositDetails: data.get('depositDetails'),
        }),
      })
      this.items = [...this.items.filter((item) => item.id !== subscription.id), subscription]
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      this.showForm = false
      this.editing = null
      this.notice = id ? 'Suscripción actualizada.' : 'Suscripción registrada.'
      this.notifyChange()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  async requestDelete(item) {
    this.pendingDelete = item
    this.error = ''
    await this.updateComplete
    this.renderRoot.querySelector('dialog').showModal()
  }

  closeDeleteDialog() {
    if (this.submitting) return
    this.renderRoot.querySelector('dialog').close()
    this.pendingDelete = null
  }

  async confirmDeleteSubscription() {
    const item = this.pendingDelete
    if (!item || this.submitting) return
    this.submitting = true
    this.error = ''
    this.notice = ''
    try {
      const result = await apiRequest(`/api/subscriptions/${item.id}`, { method: 'DELETE' })
      if (result.cancelled) {
        this.items = this.items.map((entry) => entry.id === item.id ? { ...entry, status: 'cancelada' } : entry)
      } else {
        this.items = this.items.filter((entry) => entry.id !== item.id)
      }
      if (this.editing?.id === item.id) {
        this.editing = null
        this.showForm = false
      }
      this.notice = result.cancelled ? 'Suscripción cancelada; se conserva su historial de movimientos.' : 'Suscripción eliminada.'
      this.renderRoot.querySelector('dialog').close()
      this.pendingDelete = null
      this.notifyChange()
    } catch (error) {
      this.error = error.message
    } finally {
      this.submitting = false
    }
  }

  renderForm() {
    const item = this.editing
    const costs = calculateCosts(this.formCost, this.formFrequency)
    const options = item?.frequency && !frequencies.includes(item.frequency)
      ? [item.frequency, ...frequencies] : frequencies
    return html`
      <form id="subscription-form" class="module-form" @submit=${this.save}>
        <h3 class="form-hint">${item ? `Editar suscripción: ${item.name}` : 'Nueva suscripción'}</h3>
        <label>Fecha de inicio
          <input name="startDate" type="date" min="1000-01-01" max="9999-12-31" .value=${item?.startDate || ''} required />
          <small>Desde esta fecha se programan los cobros.</small>
        </label>
        <label>Nombre
          <input name="name" maxlength="100" .value=${item?.name || ''} required />
        </label>
        <label>Tipo
          <select name="type" required>
            <option value="suscripcion" .selected=${!item || item.type === 'suscripcion'}>Suscripción</option>
            <option value="servicio" .selected=${item?.type === 'servicio'}>Servicio</option>
          </select>
        </label>
        <label>Costo por cobro
          <input name="cost" type="number" min="0.01" max="9999999999999.99" step="0.01" .value=${item?.cost ?? ''}
            @input=${(event) => { this.formCost = event.target.value }} required />
        </label>
        <label>Frecuencia
          <select name="frequency" @change=${(event) => { this.formFrequency = event.target.value }} required>
            ${options.map((frequency) => html`
              <option value=${frequency} .selected=${frequency === (item?.frequency || 'Mensual')}>${frequency}</option>
            `)}
          </select>
        </label>
        <label>Costo mensual calculado
          <output>${costs ? money.format(costs.monthlyCost) : 'Introduce costo y frecuencia'}</output>
        </label>
        <label>${isWeekly(this.formFrequency) ? 'Día de la semana' : 'Día de cobro (del mes)'}
          ${keyed(isWeekly(this.formFrequency), isWeekly(this.formFrequency) ? html`
            <select name="billingDay">
              <option value="">Sin definir</option>
              ${weekdays.map((day, index) => html`
                <option value=${index + 1} .selected=${isWeekly(item?.frequency) && Number(item?.billingDay) === index + 1}>${day}</option>
              `)}
            </select>
          ` : html`
            <input name="billingDay" type="number" min="1" max="31" step="1"
              .value=${!isWeekly(item?.frequency) ? item?.billingDay ?? '' : ''} />
          `)}
        </label>
        <label>Tipo de pago
          <select name="paymentType" required>
            <option value="" .selected=${!['manual', 'automatico'].includes(item?.paymentType)}>Selecciona una opción</option>
            <option value="manual" .selected=${item?.paymentType === 'manual'}>Manual</option>
            <option value="automatico" .selected=${item?.paymentType === 'automatico'}>Automático (domiciliado)</option>
          </select>
        </label>
        <label>Estado
          <input name="status" maxlength="30" .value=${item?.status || 'activa'} required list="subscription-statuses" />
          <datalist id="subscription-statuses"><option value="activa"></option><option value="cancelada"></option></datalist>
        </label>
        <label>Datos de depósito (opcional)<input name="depositDetails" maxlength="500"
          placeholder="Banco, titular, cuenta, CLABE o referencia" .value=${item?.depositDetails || ''} /></label>
        <p class="form-hint">Monetizado se calcula sumando los importes de todos los movimientos vinculados a esta suscripción; no se captura manualmente.</p>
        <p class="form-hint">Mensual semanal: costo por cobro × 4 semanas. Estimación anual: costo por cobro × número de cobros al año. Semanal: 52; mensual: 12; trimestral: 4; semestral: 2; anual: 1. Para las demás frecuencias, el mensual es el anual ÷ 12.</p>
        <div class="form-actions">
          <button class="primary-button compact-button" type="submit" ?disabled=${this.submitting}>
            ${this.submitting ? 'Guardando…' : item ? 'Guardar cambios' : 'Registrar suscripción'}
          </button>
        </div>
      </form>
    `
  }

  renderBillingIndicator(item) {
    if (item.status.toLowerCase() !== 'activa') {
      return html`<p class="billing-indicator">Sin próximo cobro: ${item.status}</p>`
    }
    const days = daysUntilBilling(item.frequency, item.billingDay, this.today, item.startDate)
    if (days == null) return html`<p class="billing-indicator">Configura el día de cobro para ver cuánto falta.</p>`
    const longerPeriod = !item.startDate && !['semanal', 'mensual'].includes(String(item.frequency).trim().toLowerCase())
    return html`
      <div class="billing-indicator billing-countdown ${days === 0 ? 'billing-today' : days <= 2 ? 'billing-soon' : ''}"
        role="status">
        <strong>${days === 0 ? '¡Hoy es día de pagar!' : days === 1 ? 'Falta 1 día para pagar' : `Faltan ${days} días para pagar`}</strong>
        ${longerPeriod ? html`<small>Referencia al próximo día configurado; no incluye el mes de inicio del periodo.</small>` : ''}
      </div>
    `
  }

  render() {
    return html`
      <section>
        <div class="section-heading">
          <h2>Suscripciones y servicios</h2>
          <button class="primary-button compact-button" type="button" ?hidden=${this.familyView} ?disabled=${this.submitting}
            @click=${() => this.showForm ? (this.showForm = false) : this.openForm()}>
            ${this.showForm ? 'Cerrar formulario' : '+ Agregar suscripción'}
          </button>
        </div>
        ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
        ${this.notice ? html`<p class="success-message" role="status">${this.notice}</p>` : ''}
        ${this.showForm ? keyed(this.editing?.id ?? 'new', this.renderForm()) : ''}
        ${this.loading ? html`<p class="empty-state" role="status">Cargando suscripciones…</p>`
          : this.items.length ? html`
            <div class="subscription-grid">
              ${this.items.map((item) => html`
                <article class="subscription-card" @click=${(event) => {
                  if (!event.target.closest('button')) this.selectedSubscription = item
                }}>
                  <div class="subscription-heading">
                    <span class="subscription-type">${item.type === 'servicio' ? 'Servicio' : 'Suscripción'}</span>
                    <span class="status-tag ${item.status.toLowerCase() === 'activa' ? '' : 'inactive'}">${item.status}</span>
                  </div>
                  <h3>${item.name}</h3>
                  <p class="subscription-price">${money.format(item.cost)} <small>· ${item.frequency}</small></p>
                  ${this.renderBillingIndicator(item)}
                  <dl>
                    <div><dt>Fecha de inicio</dt><dd>${item.startDate || 'Sin definir; configura al editar'}</dd></div>
                    <div class="annual-cost"><dt>Costo estimado por 1 año</dt><dd>${item.annualCost == null ? 'Revisa la frecuencia' : money.format(item.annualCost)}</dd></div>
                    ${String(item.frequency).trim().toLowerCase() !== 'mensual' ? html`
                      <div><dt>Costo mensual</dt><dd>${item.monthlyCost == null ? 'Sin calcular' : money.format(item.monthlyCost)}</dd></div>
                    ` : ''}
                    <div><dt>Monetizado hasta el momento</dt><dd>${money.format(item.monetized)}</dd></div>
                    <div><dt>${isWeekly(item.frequency) ? 'Día de la semana' : 'Día de cobro'}</dt>
                      <dd>${item.billingDay == null ? 'Sin definir' : isWeekly(item.frequency) ? weekdays[Number(item.billingDay) - 1] || 'Sin definir' : `Día ${item.billingDay}`}</dd></div>
                    <div><dt>Tipo de pago</dt><dd>${item.paymentType === 'manual' ? 'Manual'
                      : item.paymentType === 'automatico' ? 'Automático (domiciliado)' : 'Sin definir'}</dd></div>
                  </dl>
                  ${item.depositDetails ? html`<p class="form-hint deposit-details">Depósito: ${item.depositDetails}</p>` : ''}
                  <div class="subscription-actions">
                    <button class="text-button" type="button"
                      aria-pressed=${this.selectedSubscription?.id === item.id ? 'true' : 'false'}
                      @click=${() => { this.selectedSubscription = item }}>Ver movimientos</button>
                    <button class="text-button" type="button" ?hidden=${this.familyView} ?disabled=${this.submitting} @click=${() => this.openForm(item)}>Editar</button>
                    <button class="trash-button" type="button" ?hidden=${this.familyView} ?disabled=${this.submitting}
                      aria-label=${`Eliminar ${item.name}`} title="Eliminar suscripción" @click=${() => this.requestDelete(item)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
                      </svg>
                    </button>
                  </div>
                </article>
              `)}
            </div>
          ` : html`<p class="empty-state">No tienes suscripciones registradas. Usa «Agregar suscripción» para crear la primera.</p>`}
        ${this.items.some((item) => item.id === this.selectedSubscription?.id) ? html`
          <finance-related-movements relation="subscription"
            .familyView=${this.familyView} .relationId=${this.selectedSubscription.id} .label=${this.selectedSubscription.name}></finance-related-movements>
        ` : ''}
        ${!this.loading && this.error ? html`<button class="quiet-button" type="button" ?disabled=${this.submitting} @click=${this.load}>Actualizar lista</button>` : ''}
        <dialog class="delete-dialog" aria-labelledby="delete-subscription-title"
          aria-describedby="delete-subscription-description"
          @cancel=${(event) => {
            if (this.submitting) event.preventDefault()
            else this.pendingDelete = null
          }}>
          <h2 id="delete-subscription-title">¿Estás seguro que quieres eliminar?</h2>
          <p id="delete-subscription-description">
            ${this.pendingDelete?.name}
          </p>
          <p>Si tiene movimientos asociados, se cancelará y se conservará su historial. Si no tiene movimientos, se eliminará definitivamente.</p>
          ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
          <div class="delete-dialog-actions">
            <button class="quiet-button" type="button" autofocus ?disabled=${this.submitting} @click=${this.closeDeleteDialog}>Cancelar</button>
            <button class="primary-button confirm-delete" type="button" ?disabled=${this.submitting} @click=${this.confirmDeleteSubscription}>
              ${this.submitting ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </dialog>
      </section>
    `
  }
}

customElements.define('finance-subscriptions', Subscriptions)
