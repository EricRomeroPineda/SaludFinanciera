import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../api.js'
import calendarStyles from './calendario.css?inline'

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const monthFormat = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

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
  }

  constructor() {
    super()
    const now = new Date()
    this.month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    this.selectedDay = localDateString(now)
    this.data = null
    this.error = ''
    this.loading = true
  }

  connectedCallback() {
    super.connectedCallback()
    this.loadMonth()
  }

  async loadMonth() {
    this.loading = true
    this.error = ''
    try {
      this.data = await apiRequest(`/api/calendar?month=${encodeURIComponent(this.month)}`)
      const selectedDayNumber = Number(this.selectedDay.slice(-2))
      const lastDayNumber = Number(this.lastDay().slice(-2))
      this.selectedDay = `${this.month}-${String(Math.min(selectedDayNumber, lastDayNumber)).padStart(2, '0')}`
    } catch (error) {
      this.error = error.message
      this.data = null
    } finally {
      this.loading = false
    }
  }

  lastDay() {
    const [year, month] = this.month.split('-').map(Number)
    return `${this.month}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  }

  changeMonth(delta) {
    const [year, month] = this.month.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1 + delta, 1))
    this.month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    this.loadMonth()
  }

  formatMoney(value) {
    return currency.format(Number(value) || 0)
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

    return html`
      <div class="calendar-layout">
        <section class="calendar-card">
          <div class="calendar-heading">
            <button class="calendar-nav" type="button" aria-label="Mes anterior" @click=${() => this.changeMonth(-1)}>‹</button>
            <h2>${monthTitle}</h2>
            <button class="calendar-nav" type="button" aria-label="Mes siguiente" @click=${() => this.changeMonth(1)}>›</button>
          </div>
          <div class="weekdays" aria-hidden="true">
            ${['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'].map((day) => html`<span>${day}</span>`)}
          </div>
          <div class="days-grid">
            ${dates.map((day) => {
              if (!day) return html`<span class="day-button empty"></span>`
              const date = `${this.month}-${String(day).padStart(2, '0')}`
              const activity = dayData.get(date)
              const isToday = date === localDateString(new Date())
              return html`
                <button
                  type="button"
                  class="day-button ${date === this.selectedDay ? 'selected' : ''} ${isToday ? 'today' : ''}"
                  aria-label="${date}${activity ? `, ${activity.count} movimientos` : ''}"
                  aria-pressed=${date === this.selectedDay}
                  @click=${() => { this.selectedDay = date }}
                >
                  ${day}${activity ? html`<span class="day-count">${activity.count}</span>` : ''}
                </button>
              `
            })}
          </div>
          <div class="calendar-summary">
            <span>Ingresos<strong class="income">${this.formatMoney(selected?.income)}</strong></span>
            <span>Gastos<strong class="expense">${this.formatMoney(selected?.expenses)}</strong></span>
            <span>Movimientos<strong>${selected?.count || 0}</strong></span>
          </div>
        </section>

        <section class="day-card">
          <h2 class="day-title">${dayFormat.format(selectedDate)}</h2>
          <p class="day-total">${selected ? `${selected.count} movimiento${selected.count === 1 ? '' : 's'} en este día` : 'Sin movimientos registrados en este día'}</p>
          ${this.error ? html`<p class="calendar-empty" role="alert">${this.error}</p>`
            : this.loading ? html`<p class="calendar-loading">Cargando movimientos…</p>`
              : html`<div class="day-list">
                ${(this.data?.movements || [])
                  .filter((movement) => movement.date === this.selectedDay)
                  .map((movement) => {
                    const transfer = movement.originAccount && movement.destinationAccount
                    const income = movement.categoryType === 'ingreso' ||
                      (!movement.originAccount && Boolean(movement.destinationAccount))
                    return html`
                      <article class="day-movement">
                        <span class="movement-sign ${income ? 'income' : transfer ? '' : 'expense'}">${income ? '+' : transfer ? '↔' : '−'}</span>
                        <span class="movement-text">
                          <strong>${movement.category || movement.planName || movement.subscriptionName || 'Movimiento'}</strong>
                          <small>${transfer
                            ? `${movement.originAccount} → ${movement.destinationAccount}`
                            : movement.originAccount || movement.destinationAccount || movement.planName || 'Sin cuenta relacionada'}</small>
                        </span>
                        <span class="movement-value ${income ? 'income' : transfer ? '' : 'expense'}">${this.formatMoney(movement.amount)}</span>
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
    `
  }
}

customElements.define('financial-calendar', FinancialCalendar)
