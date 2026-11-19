import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../../src/api.js'
import { movementLabel, movementOrigin, movementDestination } from '../movement-labels.js'
import './movement-evidence.js'
import './google-calendar-sync.js'
import calendarStyles from './calendario.css?inline'

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const monthFormat = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const eventLabels = { card: 'Pago de tarjeta', plan: 'Aportación a plan', subscription: 'Suscripción / servicio', loan: 'Deudas · Fecha compromiso' }

function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

class FinancialCalendar extends LitElement {
  static styles = unsafeCSS(calendarStyles)
  static properties = {
    month: { state: true },
    data: { state: true },
    selectedDay: { state: true },
    error: { state: true },
    loading: { state: true },
    revision: { attribute: false },
    scope: { state: true },
    familyView: { type: Boolean },
    expandedEvidenceId: { state: true },
  }

  constructor() {
    super()
    const now = new Date()
    this.month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    this.selectedDay = localDateString(now)
    this.data = null
    this.error = ''
    this.loading = true
    this.requestVersion = 0
    this.scope = 'all'
    this.expandedEvidenceId = null
  }

  updated(changed) {
    if (changed.has('revision') || changed.has('familyView') || !this.started) {
      this.started = true
      this.loadMonth()
    }
  }

  async loadMonth() {
    this.expandedEvidenceId = null
    const version = ++this.requestVersion
    const month = this.month
    this.loading = true
    this.error = ''
    this.data = null
    try {
      const data = await apiRequest(`/api/calendar?month=${encodeURIComponent(month)}&scope=${this.scope}${this.familyView ? '&view=family' : ''}`)
      if (version !== this.requestVersion) return
      this.data = data
      const selectedDayNumber = Number(this.selectedDay.slice(-2))
      const lastDayNumber = Number(this.lastDay().slice(-2))
      this.selectedDay = `${this.month}-${String(Math.min(selectedDayNumber, lastDayNumber)).padStart(2, '0')}`
    } catch (error) {
      if (version === this.requestVersion) this.error = error.message
    } finally {
      if (version === this.requestVersion) this.loading = false
    }
  }

  lastDay() {
    const [year, month] = this.month.split('-').map(Number)
    return `${this.month}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  }

  changeMonth(delta) {
    const [year, month] = this.month.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1 + delta, 1))
    if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9998) return
    this.month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    this.loadMonth()
  }

  selectYear(event) {
    const input = event.currentTarget
    const year = Number(input.value)
    if (!Number.isInteger(year) || year < 1000 || year > 9998) {
      input.setCustomValidity('El año debe estar entre 1000 y 9998.')
      input.reportValidity()
      return
    }
    input.setCustomValidity('')
    this.month = `${year}-${this.month.slice(5)}`
    this.loadMonth()
  }

  showMovementDate(date) {
    this.selectedDay = date
    if (this.month !== date.slice(0, 7)) {
      this.month = date.slice(0, 7)
      this.loadMonth()
    }
  }

  formatMoney(value) {
    return currency.format(Number(value) || 0)
  }

  requestMovement(event = null) {
    if (this.familyView) return
    this.dispatchEvent(new CustomEvent('register-movement', {
      detail: { date: this.selectedDay, event }, bubbles: true, composed: true,
    }))
  }

  movementAction(action, movement) {
    if (this.familyView) return
    this.dispatchEvent(new CustomEvent(action, { detail: movement, bubbles: true, composed: true }))
  }

  renderMonthlyTable(monthTitle) {
    const items = this.data?.movements || []
    const period = this.scope === 'all' ? 'Todos los registros'
      : this.scope === 'year' ? `Año ${this.month.slice(0, 4)}` : monthTitle
    return html`
      <section class="calendar-card monthly-register">
        <h2>Registro general · ${period}</h2>
        <label class="register-scope">Mostrar
          <select aria-label="Periodo del registro general" .value=${this.scope}
            @change=${(event) => { this.scope = event.currentTarget.value; this.loadMonth() }}>
            <option value="all" ?selected=${this.scope === 'all'}>Todos los registros</option>
            <option value="year" ?selected=${this.scope === 'year'}>Año seleccionado</option>
            <option value="month" ?selected=${this.scope === 'month'}>Mes seleccionado</option>
          </select>
        </label>
        <p class="day-total">${this.loading || this.error ? 'Consulta pendiente' : `${items.length} movimientos registrados`}</p>
        ${this.loading ? html`<p class="calendar-loading" role="status">Cargando registros…</p>`
          : this.error ? html`<p class="calendar-empty">No se pudo consultar el registro general.</p>`
            : items.length ? html`
              <div class="monthly-table-scroll" tabindex="0" role="region" aria-label="Registro general de movimientos">
                <table>
                  <thead><tr><th>Fecha</th><th>Operación</th><th>Origen</th><th>Destino</th><th>Categoría</th><th>Plan</th><th>Suscripción</th><th>Monto</th><th>Evidencia</th><th>Acciones</th></tr></thead>
                  <tbody>${items.map((item) => html`
                    <tr>
                      <td><button class="calendar-action" type="button" aria-label=${`Ver movimientos del ${item.date}`}
                        @click=${() => this.showMovementDate(item.date)}>${item.date}</button></td>
                      <td>${movementLabel(item)}</td>
                      <td>${movementOrigin(item)}</td><td>${movementDestination(item)}</td>
                      <td>${item.category || 'Sin categoría'}</td><td>${item.planName || '—'}</td>
                      <td>${item.subscriptionName || '—'}</td><td>${this.formatMoney(item.amount)}</td>
                      <td><button class="calendar-action" type="button"
                        aria-expanded=${this.expandedEvidenceId === item.id}
                        aria-controls=${`movement-evidence-${item.id}`}
                        @click=${() => { this.expandedEvidenceId = this.expandedEvidenceId === item.id ? null : item.id }}>
                        ${this.expandedEvidenceId === item.id ? 'Ocultar evidencia' : 'Evidencia (opcional)'}
                      </button></td>
                      <td><div class="monthly-actions">
                        ${!this.familyView && item.loanKind !== 'desembolso' ? html`
                          <button class="calendar-action" type="button" @click=${() => this.movementAction('edit-movement', item)}>Editar</button>
                          <button class="calendar-action danger" type="button" @click=${() => this.movementAction('delete-movement', item)}>Eliminar</button>
                        ` : item.loanKind === 'desembolso' ? 'Desembolso fijo' : 'Solo consulta'}
                      </div></td>
                    </tr>
                    ${this.expandedEvidenceId === item.id ? html`
                      <tr class="evidence-detail-row">
                        <td colspan="10" id=${`movement-evidence-${item.id}`}>
                          <movement-evidence .movementId=${item.id} .readOnly=${this.familyView}
                            .expanded=${true} .hideToggle=${true}></movement-evidence>
                        </td>
                      </tr>
                    ` : ''}
                  `)}</tbody>
                </table>
              </div>
            ` : html`<p class="calendar-empty">No hay movimientos registrados${this.scope === 'all' ? '' : ' en el periodo seleccionado'}.</p>`}
      </section>
    `
  }

  render() {
    const [year, monthNumber] = this.month.split('-').map(Number)
    const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
    const dayData = new Map((this.data?.days || []).map((day) => [day.day, day]))
    const selected = dayData.get(this.selectedDay)
    const monthTitle = monthFormat.format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    const offsets = Array.from({ length: firstWeekday }, () => null)
    const dates = [...offsets, ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
    const selectedDate = new Date(`${this.selectedDay}T00:00:00Z`)
    const monthCategories = this.data?.categories || []
    const scheduled = this.data?.events || []

    return html`
      <div class="calendar-layout">
        <section class="calendar-card">
          <div class="calendar-heading">
            <button class="calendar-nav" type="button" aria-label="Mes anterior" @click=${() => this.changeMonth(-1)}>‹</button>
            <h2>${monthTitle}</h2>
            <button class="calendar-nav" type="button" aria-label="Mes siguiente" @click=${() => this.changeMonth(1)}>›</button>
          </div>
          <div class="calendar-period-controls">
            <label>Año<input aria-label="Año del calendario" type="number" min="1000" max="9998" step="1"
              .value=${String(year)} @change=${this.selectYear} /></label>
            <button class="calendar-action" type="button" @click=${this.loadMonth}>Actualizar registros</button>
          </div>
          <div class="calendar-legend" aria-label="Leyenda de colores">
            <h3>Marcadores previstos</h3>
            ${Object.entries(eventLabels).map(([kind, label]) => html`
              <span><i class="event-dot ${kind}" aria-hidden="true"></i>${label}</span>
            `)}
            <small>El número de cada día cuenta solo movimientos registrados. Los puntos indican fechas programadas, no pagos realizados.</small>
          </div>
          <google-calendar-sync .month=${this.month} .familyView=${this.familyView}
            .revision=${this.revision} .disabled=${this.loading || Boolean(this.error)}></google-calendar-sync>
          ${this.error ? html`<p class="calendar-empty" role="alert">${this.error}</p>
            <button class="calendar-action" type="button" @click=${this.loadMonth}>Reintentar</button>` : ''}
          ${this.loading ? html`<p class="calendar-loading" role="status">Cargando calendario…</p>` : ''}
          <div class="weekdays" aria-hidden="true">
            ${['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'].map((day) => html`<span>${day}</span>`)}
          </div>
          <div class="days-grid">
            ${dates.map((day) => {
              if (!day) return html`<span class="day-button empty"></span>`
              const date = `${this.month}-${String(day).padStart(2, '0')}`
              const activity = dayData.get(date)
              const kinds = [...new Set(scheduled.filter((event) => event.date === date).map((event) => event.kind))]
              const isToday = date === localDateString(new Date())
              return html`
                <button
                  type="button"
                  class="day-button ${date === this.selectedDay ? 'selected' : ''} ${isToday ? 'today' : ''}"
                  aria-label="${date}, ${activity?.count || 0} movimientos${kinds.length ? `, ${kinds.map((kind) => eventLabels[kind]).join(', ')}` : ''}"
                  aria-pressed=${date === this.selectedDay}
                  @click=${() => { this.selectedDay = date }}
                >
                  ${day}${activity ? html`<span class="day-count">${activity.count}</span>` : ''}
                  <span class="day-markers" aria-hidden="true">${kinds.map((kind) => html`<i class="event-dot ${kind}"></i>`)}</span>
                </button>
              `
            })}
          </div>
          <div class="calendar-summary">
            <span>Ingresos del día<strong class="income">${this.loading || this.error ? '—' : this.formatMoney(selected?.income)}</strong></span>
            <span>Gastos del día<strong class="expense">${this.loading || this.error ? '—' : this.formatMoney(selected?.expenses)}</strong></span>
            <span>Movimientos<strong>${this.loading || this.error ? '—' : selected?.count || 0}</strong></span>
          </div>
        </section>

        <section class="day-card">
          <h2 class="day-title">${dayFormat.format(selectedDate)}</h2>
          <p class="day-total">${this.loading || this.error ? 'Consulta del día pendiente' : selected ? `${selected.count} movimiento${selected.count === 1 ? '' : 's'} en este día` : '0 movimientos registrados en este día'}</p>
          ${!this.familyView ? html`<button class="calendar-primary" type="button" @click=${() => this.requestMovement()}>+ Registrar movimiento en este día</button>` : ''}
          ${scheduled.some((event) => event.date === this.selectedDay) ? html`
            <div class="scheduled-list">
              <h3>Programado para este día</h3>
              ${scheduled.filter((event) => event.date === this.selectedDay).map((event) => html`
                <article class="scheduled-event">
                  <i class="event-dot ${event.kind}" aria-hidden="true"></i>
                  <div><strong>${event.label}</strong><small>${eventLabels[event.kind]} · ${event.amount == null ? 'Monto por definir' : this.formatMoney(event.amount)}</small>
                    ${event.reference ? html`<small>Referencia al día de cobro; falta el mes de inicio de la frecuencia.</small>` : ''}
                  </div>
                  ${!this.familyView ? html`<button class="calendar-action" type="button" @click=${() => this.requestMovement(event)}>Registrar</button>` : ''}
                </article>
              `)}
            </div>
          ` : ''}
          ${this.error ? html`<p class="calendar-empty" role="alert">${this.error}</p>`
            : this.loading ? html`<p class="calendar-loading">Cargando movimientos…</p>`
              : html`<div class="day-list">
                ${(this.data?.movements || [])
                  .filter((movement) => movement.date === this.selectedDay)
                  .map((movement) => {
                    const transfer = movement.loanId || (movement.originAccount && movement.destinationAccount)
                    const income = !movement.loanId && (movement.categoryType === 'ingreso' ||
                      (!movement.originAccount && Boolean(movement.destinationAccount)))
                    return html`
                      <article class="day-movement">
                        <span class="movement-sign ${income ? 'income' : transfer ? '' : 'expense'}">${income ? '+' : transfer ? '↔' : '−'}</span>
                        <span class="movement-text">
                          <strong>${movement.loanId ? movementLabel(movement) : movement.category || movement.planName || movement.subscriptionName || 'Movimiento'}</strong>
                          <small>${transfer
                            ? `${movementOrigin(movement)} → ${movementDestination(movement)}`
                            : movement.originAccount || movement.destinationAccount || movement.planName || 'Sin cuenta relacionada'}</small>
                        </span>
                        <span class="movement-value ${income ? 'income' : transfer ? '' : 'expense'}">${this.formatMoney(movement.amount)}</span>
                        <movement-evidence .movementId=${movement.id} .readOnly=${this.familyView}></movement-evidence>
                      </article>
                    `
                  })}
                ${!this.data?.movements?.some((movement) => movement.date === this.selectedDay)
                  ? html`<p class="calendar-empty">${this.error || (this.loading ? 'Cargando…' : 'No hay registros para la fecha seleccionada.')}</p>`
                  : ''}
              </div>`}
          ${monthCategories.length ? html`
            <div class="calendar-categories">
              <h3>Categorías del mes</h3>
              ${monthCategories.slice(0, 5).map((category) => html`
                <p><span>${category.name}</span><strong>${this.formatMoney(category.total)}</strong></p>
              `)}
            </div>
          ` : ''}
        </section>
      </div>
      ${this.renderMonthlyTable(monthTitle)}
    `
  }
}

customElements.define('financial-calendar', FinancialCalendar)
