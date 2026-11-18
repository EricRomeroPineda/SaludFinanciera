import { LitElement, html, unsafeCSS } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { apiRequest } from '../../src/api.js'
import sharedStyles from '../../src/inicio/styles.css?inline'
import financeStyles from '../frontend/styles.css?inline'
import responsiveStyles from '../frontend/responsive.css?inline'
import styles from './styles.css?inline'
import { calculateCosts, frequencies, isImageUrl, isWeekly, weekdays } from './calculations.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

class Subscriptions extends LitElement {
  static styles = [unsafeCSS(sharedStyles), unsafeCSS(financeStyles), unsafeCSS(responsiveStyles), unsafeCSS(styles)]
  static properties = {
    items: { state: true },
    loading: { state: true },
    submitting: { state: true },
    showForm: { state: true },
    editing: { state: true },
    error: { state: true },
    notice: { state: true },
    formFrequency: { state: true },
    formCost: { state: true },
    brokenImages: { state: true },
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
    this.brokenImages = new Set()
  }

  connectedCallback() {
    super.connectedCallback()
    this.load()
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
    const { subscriptions } = await apiRequest('/api/subscriptions')
    this.items = subscriptions
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

  async remove(item) {
    if (!window.confirm(`¿Eliminar "${item.name}"? Si tiene movimientos asociados se cancelará sin borrar su historial.`)) return
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
      <form class="module-form" @submit=${this.save}>
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
        <label>URL de imagen (opcional)
          <input name="paymentType" type="url" maxlength="40"
            .value=${isImageUrl(item?.paymentType) ? item.paymentType : ''} placeholder="https://sitio.com/logo.png" />
          <small>Hasta 40 caracteres, según el campo tipo_pago actual.</small>
        </label>
        <label>Estado
          <input name="status" maxlength="30" .value=${item?.status || 'activa'} required list="subscription-statuses" />
          <datalist id="subscription-statuses"><option value="activa"></option><option value="cancelada"></option></datalist>
        </label>
        <p class="form-hint">Monetizado se calcula sumando los importes de todos los movimientos vinculados a esta suscripción; no se captura manualmente.</p>
        <p class="form-hint">Estimación anual: costo por cobro × número de cobros al año. Semanal: 52; mensual: 12; trimestral: 4; semestral: 2; anual: 1. El promedio mensual es el anual ÷ 12.</p>
        <div class="form-actions">
          <button class="primary-button compact-button" type="submit" ?disabled=${this.submitting}>
            ${this.submitting ? 'Guardando…' : item ? 'Guardar cambios' : 'Registrar suscripción'}
          </button>
        </div>
      </form>
    `
  }

  render() {
    return html`
      <section>
        <div class="section-heading">
          <h2>Suscripciones y servicios</h2>
          <button class="primary-button compact-button" type="button" ?disabled=${this.submitting}
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
                <article class="subscription-card">
                  <div class="subscription-heading">
                    ${isImageUrl(item.paymentType) && !this.brokenImages.has(item.paymentType) ? html`
                      <img class="subscription-logo" src=${item.paymentType} alt=${`Imagen de ${item.name}`} referrerpolicy="no-referrer"
                        @error=${() => {
                          this.brokenImages = new Set([...this.brokenImages, item.paymentType])
                          this.error = `No se pudo cargar la imagen de ${item.name}. Revisa la URL.`
                        }} />
                    ` : ''}
                    <span class="subscription-type">${item.type === 'servicio' ? 'Servicio' : 'Suscripción'}</span>
                    <span class="status-tag ${item.status.toLowerCase() === 'activa' ? '' : 'inactive'}">${item.status}</span>
                  </div>
                  <h3>${item.name}</h3>
                  <p class="subscription-price">${money.format(item.cost)} <small>· ${item.frequency}</small></p>
                  <dl>
                    <div class="annual-cost"><dt>Costo estimado por 1 año</dt><dd>${item.annualCost == null ? 'Revisa la frecuencia' : money.format(item.annualCost)}</dd></div>
                    <div><dt>Costo mensual</dt><dd>${item.monthlyCost == null ? 'Sin calcular' : money.format(item.monthlyCost)}</dd></div>
                    <div><dt>Monetizado hasta el momento</dt><dd>${money.format(item.monetized)}</dd></div>
                    <div><dt>${isWeekly(item.frequency) ? 'Día de la semana' : 'Día de cobro'}</dt>
                      <dd>${item.billingDay == null ? 'Sin definir' : isWeekly(item.frequency) ? weekdays[Number(item.billingDay) - 1] || 'Sin definir' : `Día ${item.billingDay}`}</dd></div>
                  </dl>
                  <div class="subscription-actions">
                    <button class="text-button" type="button" ?disabled=${this.submitting} @click=${() => this.openForm(item)}>Editar</button>
                    <button class="text-button delete-button" type="button" ?disabled=${this.submitting} @click=${() => this.remove(item)}>
                      ${item.status.toLowerCase() === 'activa' ? 'Cancelar / eliminar' : 'Eliminar'}
                    </button>
                  </div>
                </article>
              `)}
            </div>
          ` : html`<p class="empty-state">No tienes suscripciones registradas. Usa «Agregar suscripción» para crear la primera.</p>`}
        ${!this.loading && this.error ? html`<button class="quiet-button" type="button" ?disabled=${this.submitting} @click=${this.load}>Actualizar lista</button>` : ''}
      </section>
    `
  }
}

customElements.define('finance-subscriptions', Subscriptions)
