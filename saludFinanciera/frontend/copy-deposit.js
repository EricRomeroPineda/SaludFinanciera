import { LitElement, html, css } from 'lit'

export const depositStyles = css`
  .card-deposit.card-deposit {
    display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-width: 0;
    grid-column: 1 / -1; margin: 0 0 18px; padding: 12px; border-radius: 8px;
    background: var(--soft); color: var(--ink); text-align: left;
  }
  .card-deposit > dl, .card-deposit > .deposit-content {
    display: block; flex: 1 1 160px; min-width: 0; margin: 0;
  }
  .card-deposit > dl > dt, .card-deposit .deposit-label {
    display: block; margin: 0 0 5px; color: var(--ink); font-size: 10px; font-weight: 400;
  }
  .card-deposit > dl > dd, .card-deposit input {
    margin: 0; color: var(--muted); font-size: 12px; font-weight: 400;
    line-height: 1.5; overflow-wrap: anywhere;
  }
  .card-deposit > copy-deposit {
    flex: 0 1 auto; max-width: 100%; margin-inline-start: auto; font-size: 12px; font-weight: 400;
  }
  .record-list .card-deposit.card-deposit { margin: 0; padding: 5px 7px; }
`

export function renderDeposit(value) {
  return html`<div class="card-payment card-deposit deposit-details">
    <dl><dt>Depósito</dt><dd>${value}</dd></dl>
    <copy-deposit .value=${value}></copy-deposit>
  </div>`
}

class CopyDeposit extends LitElement {
  static properties = {
    value: { attribute: false }, field: { type: Boolean }, busy: { state: true },
    notice: { state: true }, error: { state: true },
  }

  static styles = css`
    :host { display: inline-block; vertical-align: middle; margin-inline-start: 4px; }
    button { display: inline-grid; place-items: center; padding: 5px; border: 1px solid var(--line, #888);
      border-radius: 6px; background: var(--surface, transparent); color: var(--ink, inherit); cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    span { margin-inline-start: 6px; font-size: 12px; }
    [role=alert] { color: var(--red, #b42318); }
  `

  async copy() {
    if (this.busy) return
    this.notice = ''
    this.error = ''
    const value = this.field ? this.closest('label')?.querySelector('[name="depositDetails"]')?.value : this.value
    if (typeof value !== 'string' || !value.trim()) {
      this.error = 'No hay datos de depósito para copiar.'
      return
    }
    this.busy = true
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(value)
      this.notice = 'Datos copiados.'
    } catch {
      this.error = 'No se pudo copiar. Permite el acceso al portapapeles o copia los datos manualmente.'
    } finally {
      this.busy = false
    }
  }

  render() {
    return html`<button type="button" aria-label="Copiar datos de depósito" title="Copiar datos de depósito"
      ?disabled=${this.busy} @click=${this.copy}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </svg>
    </button>${this.notice ? html`<span role="status">${this.notice}</span>` : ''}
    ${this.error ? html`<span role="alert">${this.error}</span>` : ''}`
  }
}

customElements.define('copy-deposit', CopyDeposit)
