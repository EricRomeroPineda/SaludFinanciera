import { LitElement, html, unsafeCSS } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { apiRequest } from '../../src/api.js'
import { addIcon, sortByDue, viewToggle } from './record-view.js'
import sharedStyles from '../../src/inicio/styles.css?inline'
import styles from './styles.css?inline'
import responsiveStyles from './responsive.css?inline'
import './related-movements.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
function todayInput() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

class Loans extends LitElement {
  static styles = [unsafeCSS(sharedStyles), unsafeCSS(styles), unsafeCSS(responsiveStyles)]
  static properties = {
    items: { attribute: false }, accounts: { attribute: false }, familyView: { type: Boolean },
    showForm: { state: true }, editing: { state: true }, selectedId: { state: true },
    error: { state: true }, busy: { state: true }, mode: { state: true }, loanType: { state: true },
    pendingDelete: { state: true },
    listView: { state: true },
  }

  constructor() {
    super()
    this.items = []
    this.accounts = []
    this.familyView = false
    this.showForm = false
    this.editing = null
    this.selectedId = null
    this.error = ''
    this.busy = false
    this.mode = 'new'
    this.loanType = 'me_deben'
    this.pendingDelete = null
    this.listView = false
  }

  updated(changed) {
    if (this.showForm && (changed.has('editing') || changed.has('showForm'))) {
      this.renderRoot.querySelector('form')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    if (changed.has('pendingDelete')) {
      const dialog = this.renderRoot.querySelector('#delete-loan')
      if (this.pendingDelete && !dialog.open) dialog.showModal()
      else if (!this.pendingDelete && dialog.open) dialog.close()
    }
  }

  openForm(item = null) {
    this.editing = item
    this.loanType = item?.type || 'me_deben'
    this.mode = item?.legacy ? 'legacy' : 'new'
    this.error = ''
    this.showForm = true
  }

  async save(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = this.editing?.id
    const input = {
      name: data.get('name'), commitmentDate: data.get('commitmentDate'),
      accountId: data.get('accountId') || null, notes: data.get('notes'),
      depositDetails: data.get('depositDetails'),
      ...(!id ? {
        type: this.loanType, principal: data.get('principal'), startDate: data.get('startDate'),
        recordDisbursement: this.mode === 'new',
      } : {}),
    }
    this.busy = true
    this.error = ''
    try {
      await apiRequest(id ? `/api/loans/${id}` : '/api/loans', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(input),
      })
      this.showForm = false
      this.editing = null
      this.dispatchEvent(new CustomEvent('loans-changed', { bubbles: true, composed: true }))
    } catch (error) {
      this.error = error.message
    } finally {
      this.busy = false
    }
  }

  async deleteSelected() {
    this.busy = true
    this.error = ''
    try {
      await apiRequest(`/api/loans/${this.pendingDelete.id}`, { method: 'DELETE' })
      this.pendingDelete = null
      this.selectedId = null
      this.dispatchEvent(new CustomEvent('loans-changed', { bubbles: true, composed: true }))
    } catch (error) {
      this.error = error.message
    } finally {
      this.busy = false
    }
  }

  registerPayment(item) {
    this.dispatchEvent(new CustomEvent('loan-payment', { detail: item, bubbles: true, composed: true }))
  }

  renderForm() {
    const item = this.editing
    return html`
      <form class="module-form" @submit=${this.save}>
        <h3 class="form-hint">${item ? 'Editar préstamo' : 'Registrar préstamo'}</h3>
        <label>Persona<input name="name" maxlength="100" .value=${item?.name || ''} required /></label>
        ${!item ? html`
          <label>Tipo<select name="type" .value=${this.loanType} @change=${(event) => { this.loanType = event.currentTarget.value }}>
            <option value="me_deben">Me deben · Yo presto</option>
            <option value="debo">Yo debo · Recibo un préstamo</option>
          </select></label>
          <label>Registro<select name="mode" .value=${this.mode} @change=${(event) => { this.mode = event.currentTarget.value }}>
            <option value="new">Nuevo · Mover dinero ahora</option>
            <option value="legacy">Anterior · No mover dinero</option>
          </select></label>
          <label>${this.mode === 'legacy' ? 'Monto pendiente al comenzar el registro' : 'Monto original'}
            <input name="principal" type="number" min="0.01" step="0.01" required />
          </label>
          <label>Fecha de inicio<input name="startDate" type="date" min="1000-01-01" max="9999-12-31" .value=${todayInput()} required /></label>
        ` : html`<p class="form-hint">El tipo, monto original y fecha de inicio son fijos. Los abonos se calculan desde los movimientos.</p>`}
        <label>Fecha compromiso<input name="commitmentDate" type="date" min=${item?.startDate || '1000-01-01'} max="9999-12-31"
          .value=${item?.commitmentDate || ''} required /></label>
        <label>${item || this.mode === 'legacy' ? 'Cuenta sugerida para los abonos (opcional)'
          : this.loanType === 'me_deben' ? 'Tarjeta / efectivo de donde sale el préstamo' : 'Tarjeta / efectivo donde recibes el préstamo'}
          <select name="accountId" ?required=${!item && this.mode === 'new'}>
            <option value="">Selecciona una cuenta</option>
            ${this.accounts.map((account) => html`<option value=${account.id} ?selected=${Number(item?.accountId) === Number(account.id)}>
              ${account.name} · ${money.format(account.available)}
            </option>`)}
          </select>
        </label>
        ${(item?.type || this.loanType) === 'debo' ? html`
          <label>Datos de depósito del acreedor (opcional)<input name="depositDetails" maxlength="500"
            placeholder="Banco, titular, cuenta, CLABE o referencia" .value=${item?.depositDetails || ''} /></label>
        ` : ''}
        <label>Notas<input name="notes" maxlength="500" .value=${item?.notes || ''} /></label>
        <p class="form-hint">${this.mode === 'legacy'
          ? 'No se creará un desembolso ni se modificará ninguna cuenta. Captura solo lo que queda por cobrar o pagar; los abonos nuevos reducirán ese monto.'
          : this.loanType === 'me_deben'
            ? 'El dinero saldrá de tu cuenta y quedará por cobrar en este préstamo; no se suma al disponible.'
            : 'El dinero se agregará al disponible de la cuenta elegida y quedará como deuda pendiente.'}
          Los préstamos y abonos se identifican por separado de ingresos y gastos ordinarios.</p>
        <div class="form-actions"><button class="primary-button compact-button" ?disabled=${this.busy}>${this.busy ? 'Guardando…' : 'Guardar préstamo'}</button></div>
      </form>
    `
  }

  render() {
    const selected = this.items.find((item) => item.id === this.selectedId)
    const today = todayInput()
    const items = sortByDue(this.items, (item) => Number(item.remaining) > 0
      ? Date.parse(`${item.commitmentDate}T00:00:00Z`) : null)
    const groups = [
      { type: 'me_deben', title: 'Me deben' },
      { type: 'debo', title: 'Yo debo' },
    ]
    return html`
      <section class="data-card">
        <div class="section-heading viewer-heading">
          <div><p class="eyebrow">PRÉSTAMOS Y ADEUDOS</p><h2>Deudores · Me deben y yo debo</h2></div>
          ${viewToggle(this.listView, () => { this.listView = !this.listView })}
          <button class="primary-button compact-button" type="button" ?hidden=${this.familyView} ?disabled=${this.busy}
            @click=${() => this.showForm ? (this.showForm = false) : this.openForm()}>
            ${this.showForm ? 'Cerrar formulario' : html`${addIcon()}Nuevo préstamo`}
          </button>
        </div>
        ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
        ${this.showForm && !this.familyView ? keyed(this.editing?.id || 'new', this.renderForm()) : ''}
        ${this.items.length ? html`
          <div class=${`loan-type-groups${this.listView ? ' list-groups' : ''}`}>
          ${groups.map((group) => html`
            <section class="loan-type-group" aria-label=${group.title}>
            <h3 class="card-group-title">${group.title}</h3>
            ${items.some((item) => item.type === group.type) ? html`
          <div class=${this.listView ? 'record-list' : 'card-grid'}>${items.filter((item) => item.type === group.type).map((item) => {
            const completed = Number(item.remaining) <= 0
            const days = Math.round((Date.parse(`${item.commitmentDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
            return html`
              <article class=${`plan-card ${this.selectedId === item.id ? 'selected' : ''}`} tabindex="0"
                aria-label=${`${item.name}. Mostrar movimientos del préstamo`}
                @click=${(event) => { if (!event.target.closest('button')) this.selectedId = item.id }}
                @keydown=${(event) => {
                  if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                    event.preventDefault()
                    this.selectedId = item.id
                  }
                }}>
                <div class="credit-card-heading"><span>${item.type === 'me_deben' ? 'Me deben' : 'Yo debo'}</span><span>${completed ? 'Liquidado' : 'Pendiente'}</span></div>
                <h3>${item.name}</h3>
                <div class="card-balances">
                  <div class="card-main-balance"><span>${item.type === 'me_deben' ? 'Por cobrar' : 'Por pagar'}</span><strong>${money.format(item.remaining)}</strong></div>
                </div>
                <dl class="card-dates">
                  <div><dt>Monto registrado</dt><dd>${money.format(item.principal)}</dd></div>
                  <div><dt>Abonado</dt><dd>${money.format(item.paid)}</dd></div>
                  <div><dt>Fecha de inicio</dt><dd>${item.startDate}</dd></div>
                  <div><dt>Fecha compromiso</dt><dd>${item.commitmentDate}</dd></div>
                  <div><dt>Cuenta sugerida</dt><dd>${item.accountName || 'Seleccionar al abonar'}</dd></div>
                  <div><dt>Registro</dt><dd>${Number(item.legacy) ? 'Anterior · Sin desembolso' : 'Con desembolso registrado'}</dd></div>
                </dl>
                ${!completed ? html`<p class="plan-countdown ${days <= 2 ? 'urgent' : ''}">
                  ${days < 0 ? `Compromiso vencido hace ${Math.abs(days)} días` : days === 0 ? 'El compromiso vence hoy' : `Faltan ${days} días para el compromiso`}
                </p>` : ''}
                ${item.notes ? html`<p class="plan-note">${item.notes}</p>` : ''}
                ${item.type === 'debo' && item.depositDetails ? html`<p class="plan-note deposit-details">Depósito: ${item.depositDetails}</p>` : ''}
                <div class="card-actions" ?hidden=${this.familyView}>
                  <button class="text-button" type="button" ?disabled=${this.busy || completed} @click=${() => this.registerPayment(item)}>Registrar abono</button>
                  <button class="text-button" type="button" ?disabled=${this.busy} @click=${() => this.openForm(item)}>Editar</button>
                  <button class="card-trash-button" type="button" ?disabled=${this.busy} aria-label=${`Eliminar préstamo de ${item.name}`}
                    title="Eliminar préstamo" @click=${() => { this.error = ''; this.pendingDelete = item }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>
                  </button>
                </div>
              </article>
            `
          })}</div>` : html`<p class="empty-state">No hay préstamos en ${group.title}.</p>`}
            </section>
          `)}
          </div>
        ` : html`<p class="empty-state">No tienes préstamos registrados.</p>`}
        ${selected ? keyed(this.items, html`<finance-related-movements relation="loan" .familyView=${this.familyView}
          .relationId=${selected.id} .label=${selected.name}></finance-related-movements>`) : ''}
        <dialog id="delete-loan" class="plan-delete-dialog" aria-labelledby="delete-loan-title" @cancel=${(event) => {
          event.preventDefault()
          if (!this.busy) this.pendingDelete = null
        }}>
          <h2 id="delete-loan-title">¿Eliminar el préstamo?</h2>
          <p>${this.pendingDelete?.name}. Solo se elimina si no tiene movimientos; no se borrará historial.</p>
          ${this.error ? html`<p class="error-message" role="alert">${this.error}</p>` : ''}
          <div class="form-actions">
            <button class="quiet-button" type="button" ?disabled=${this.busy} @click=${() => { this.pendingDelete = null }}>Cancelar</button>
            <button class="primary-button" type="button" ?disabled=${this.busy} @click=${this.deleteSelected}>Eliminar</button>
          </div>
        </dialog>
      </section>
    `
  }
}

customElements.define('finance-loans', Loans)
