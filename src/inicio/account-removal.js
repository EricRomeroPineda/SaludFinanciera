import { LitElement, html, css } from 'lit'
import { apiRequest } from '../api.js'
import { protectedAdminId } from '../../shared/user-roles.js'

class AccountRemoval extends LitElement {
  static properties = {
    userId: { type: Number }, userName: { type: String }, admin: { type: Boolean },
    action: { state: true }, step: { state: true }, busy: { state: true }, error: { state: true },
  }
  static styles = css`
    :host { display: block; color: var(--ink); }
    * { box-sizing: border-box; }
    section { margin-top: 20px; padding: 18px; border: 1px solid var(--negative); border-radius: 12px; }
    h2 { font-size: 18px; } h3 { margin-top: 0; }
    p, li { line-height: 1.5; } li { margin-bottom: 8px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
    button, input { font: inherit; padding: 10px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
    button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
    button.danger { color: var(--negative); border-color: var(--negative); font-weight: 700; }
    :is(button, input):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
    dialog { width: min(94vw, 560px); max-height: 90vh; overflow-y: auto; padding: 24px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
    dialog::backdrop { background: rgb(0 0 0 / .6); }
    label { display: grid; gap: 8px; } input { min-width: 0; width: 100%; }
    .error { color: var(--negative); }
  `
  constructor() {
    super()
    this.admin = false
    this.action = ''
    this.step = 0
    this.busy = false
    this.error = ''
  }
  updated() {
    for (const [id, step] of [['removal-first', 1], ['removal-final', 2]]) {
      const dialog = this.renderRoot.querySelector(`#${id}`)
      if (dialog?.open && this.step !== step) dialog.close()
    }
    const active = this.renderRoot.querySelector(this.step === 1 ? '#removal-first' : '#removal-final')
    if (this.step && active && !active.open) active.showModal()
  }
  begin(action) {
    this.action = action
    this.step = 1
    this.error = ''
    for (const input of this.renderRoot.querySelectorAll('input')) input.value = ''
  }
  cancel(event) {
    event?.preventDefault()
    if (!this.busy) { this.step = 0; this.error = '' }
  }
  async submit(event) {
    event.preventDefault()
    if (this.action === 'delete' && this.step === 1) { this.step = 2; return }
    if (!this.step || (this.action === 'delete' && this.step !== 2)) return
    const password = new FormData(event.currentTarget).get('password')
    this.busy = true
    this.error = ''
    try {
      const path = this.admin ? `/api/admin/users/${this.userId}` : this.action === 'clear' ? '/api/auth/clear-data' : '/api/auth/account'
      const result = await apiRequest(path, {
        method: this.action === 'clear' ? 'POST' : 'DELETE',
        body: JSON.stringify({ password, confirm: true, confirmPermanent: this.action === 'delete' }),
      })
      this.step = 0
      this.dispatchEvent(new CustomEvent('account-removed', {
        detail: { ...result, id: this.userId }, bubbles: true, composed: true,
      }))
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  renderConsequences() {
    return html`<ul>
      <li>Se borrarán las cuentas financieras, movimientos propios, servicios, suscripciones, planes, préstamos y evidencias del usuario.</li>
      <li>Se desvinculará de su familia. Si la creó, se disolverá la familia y sus invitaciones; los demás conservarán sus propios datos.</li>
      <li>Los pagos y transferencias compartidos quedarán como historial de solo lectura para el otro integrante, sin identificar la cuenta desvinculada y sin modificar su saldo. Se retirarán las evidencias del usuario que está borrando sus datos.</li>
      <li>${this.action === 'clear' ? 'Se conservarán el usuario, contraseña, correo, foto, tema y rol para empezar de nuevo.'
        : 'También se eliminarán el perfil, foto, correo, rol y acceso. La sesión dejará de funcionar.'}</li>
      <li>No se puede deshacer desde la aplicación. No se cancelan suscripciones ni pagos reales con bancos o proveedores; los respaldos previos del servidor no se modifican.</li>
    </ul>`
  }
  render() {
    const protectedAccount = Number(this.userId) === protectedAdminId
    return html`
      ${this.admin ? html`<button class="danger" type="button" ?disabled=${this.busy || protectedAccount}
        @click=${() => this.begin('delete')}>Eliminar usuario</button>` : html`
        <section><h2>Borrar información y cuenta</h2>
          <p>Acciones permanentes. Revisa las consecuencias y guarda una copia antes de continuar.</p>
          <div class="actions">
            <button class="danger" type="button" @click=${() => this.begin('clear')} ?disabled=${this.busy}>Borrar información</button>
            <button class="danger" type="button" @click=${() => this.begin('delete')} ?disabled=${this.busy || protectedAccount}>Eliminar cuenta definitivamente</button>
          </div>
          ${protectedAccount ? html`<p>El administrador ID 2 no se puede eliminar; sí puede borrar su información financiera.</p>` : ''}
        </section>`}
      <dialog id="removal-first" aria-labelledby="removal-title" @cancel=${this.cancel}>
        <form @submit=${this.submit}>
          <h3 id="removal-title">${this.action === 'clear' ? '¿Borrar toda la información?' : '¿Eliminar la cuenta definitivamente?'}</h3>
          <p>Usuario: <strong>${this.userName}</strong> · ID ${this.userId}</p>
          ${this.renderConsequences()}
          ${this.action === 'clear' ? html`<label>Tu contraseña actual<input name="password" type="password" autocomplete="current-password" required ?disabled=${this.busy} /></label>` : ''}
          ${this.step === 1 && this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <div class="actions"><button type="button" @click=${this.cancel} ?disabled=${this.busy} autofocus>Cancelar</button>
            <button class="danger" type="submit" ?disabled=${this.busy}>${this.busy ? 'Borrando…' : this.action === 'clear' ? 'Sí, borrar información' : 'Continuar a segunda confirmación'}</button></div>
        </form>
      </dialog>
      <dialog id="removal-final" aria-labelledby="removal-final-title" @cancel=${this.cancel}>
        <form @submit=${this.submit}>
          <h3 id="removal-final-title">Última confirmación: ¿estás totalmente seguro?</h3>
          <p>Eliminarás definitivamente a <strong>${this.userName}</strong> (ID ${this.userId}), su perfil, acceso y datos financieros. No podrás recuperarlos desde la aplicación.</p>
          <p>La familia se desvinculará o disolverá; el historial compartido del otro integrante se conservará sin cambiar su saldo. Los respaldos anteriores no se eliminan.</p>
          <label>${this.admin ? 'Tu contraseña de administrador' : 'Tu contraseña actual'}<input name="password" type="password" autocomplete="current-password" required ?disabled=${this.busy} /></label>
          ${this.step === 2 && this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <div class="actions"><button type="button" @click=${this.cancel} ?disabled=${this.busy} autofocus>No, conservar cuenta</button>
            <button class="danger" type="submit" ?disabled=${this.busy}>${this.busy ? 'Eliminando…' : 'Sí, eliminar definitivamente'}</button></div>
        </form>
      </dialog>
    `
  }
}
customElements.define('account-removal', AccountRemoval)
