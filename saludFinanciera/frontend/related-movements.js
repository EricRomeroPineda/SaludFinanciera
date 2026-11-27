import { LitElement, html, unsafeCSS } from 'lit'
import { apiRequest } from '../../src/api.js'
import { movementLabel, movementOrigin, movementDestination } from '../movement-labels.js'
import sharedStyles from '../../src/inicio/styles.css?inline'
import financeStyles from './styles.css?inline'
import styles from './related-movements.css?inline'
import './movement-evidence.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

class RelatedMovements extends LitElement {
  static styles = [unsafeCSS(sharedStyles), unsafeCSS(financeStyles), unsafeCSS(styles)]
  static properties = {
    relation: { type: String },
    familyView: { type: Boolean },
    relationId: { type: Number },
    label: { type: String },
    items: { state: true },
    loading: { state: true },
    error: { state: true },
  }

  constructor() {
    super()
    this.items = []
    this.loading = true
    this.error = ''
    this.requestVersion = 0
  }

  updated(changed) {
    if (changed.has('relation') || changed.has('relationId') || changed.has('familyView')) this.load()
  }

  async load() {
    const version = ++this.requestVersion
    this.loading = true
    this.error = ''
    this.items = []
    try {
      const { movements } = await apiRequest(
        `/api/movements?relation=${encodeURIComponent(this.relation)}&id=${encodeURIComponent(this.relationId)}${this.familyView ? '&view=family' : ''}`,
      )
      if (version === this.requestVersion) this.items = movements
    } catch (error) {
      if (version === this.requestVersion) this.error = error.message
    } finally {
      if (version === this.requestVersion) this.loading = false
    }
  }

  render() {
    return html`
      <section class="data-card" aria-label=${`Movimientos de ${this.label}`}>
        <div class="section-heading"><h2>Movimientos de ${this.label}</h2></div>
        ${this.loading ? html`<p role="status">Cargando movimientos…</p>`
          : this.error ? html`
            <p class="error-message" role="alert">${this.error}</p>
            <button class="quiet-button" type="button" @click=${this.load}>Reintentar</button>
          ` : this.items.length ? html`
            <div class="table-scroll" tabindex="0" role="region" aria-label="Detalle de movimientos">
              <table>
                <thead><tr><th>ID movimiento</th><th>Fecha</th><th>Operación</th><th>Origen</th><th>Destino</th><th>Categoría</th><th>Suscripción</th><th>Monto</th><th>Evidencia</th></tr></thead>
                <tbody>${this.items.map((item) => html`
                  <tr>
                    <td>${item.id}</td>
                    <td>${item.date || 'Sin fecha'}</td>
                    <td>${movementLabel(item)}</td>
                    <td>${movementOrigin(item)}</td>
                    <td>${movementDestination(item)}</td>
                    <td>${item.category || 'Sin categoría'}</td>
                    <td>${item.subscriptionName || '—'}</td>
                    <td class="amount">${money.format(item.amount)}</td>
                    <td><movement-evidence .movementId=${item.id} .hasEvidence=${Boolean(item.hasEvidence)}
                      .readOnly=${this.familyView || item.canEdit === false}></movement-evidence></td>
                  </tr>
                `)}</tbody>
              </table>
            </div>
          ` : html`<p class="empty-state">No hay movimientos.</p>`}
      </section>
    `
  }
}

customElements.define('finance-related-movements', RelatedMovements)
