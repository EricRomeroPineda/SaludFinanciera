import { LitElement, html, css } from 'lit'
import { apiRequest } from '../api.js'
import { protectedAdminId, userRoles, userRoleLabel } from '../../shared/user-roles.js'
import './account-removal.js'

const root = '/api/admin/users'

class UserManagement extends LitElement {
  static properties = {
    users: { state: true }, search: { state: true }, busy: { state: true },
    error: { state: true }, notice: { state: true },
  }
  static styles = css`
    :host { display: block; color: var(--ink); }
    * { box-sizing: border-box; }
    h1 { font-size: 24px; }
    p { line-height: 1.5; }
    label { display: grid; gap: 6px; font-size: 13px; }
    input, select, button { font: inherit; color: var(--ink); background: var(--surface);
      border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
    input { width: 100%; }
    button { cursor: pointer; } button:disabled, select:disabled { opacity: .6; }
    :is(input, select, button):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
    ul { list-style: none; padding: 0; display: grid; gap: 12px; }
    li { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    .identity { flex: 1; min-width: 120px; overflow-wrap: anywhere; }
    small { display: block; margin-top: 6px; color: var(--muted); }
    .error { color: var(--negative); } .notice { color: var(--positive); }
  `
  constructor() {
    super()
    this.users = []
    this.search = ''
    this.busy = false
    this.error = ''
    this.notice = ''
  }
  connectedCallback() {
    super.connectedCallback()
    this.load()
  }
  async load() {
    this.busy = true
    this.error = ''
    try { this.users = (await apiRequest(root)).users }
    catch (error) { this.error = error.message; this.users = [] }
    finally { this.busy = false }
  }
  async save(event, user) {
    event.preventDefault()
    const role = new FormData(event.currentTarget).get('role')
    this.busy = true
    this.error = ''
    this.notice = ''
    try {
      await apiRequest(`${root}/${user.id}/role`, { method: 'PUT', body: JSON.stringify({ role }) })
      this.users = this.users.map((entry) => entry.id === user.id ? { ...entry, role } : entry)
      this.notice = `Rol de ${user.name} actualizado a ${userRoleLabel(role)}.`
      this.dispatchEvent(new CustomEvent('user-role-updated', { detail: { id: user.id, role }, bubbles: true, composed: true }))
    } catch (error) { this.error = error.message }
    finally { this.busy = false }
  }
  render() {
    const users = this.users.filter((user) => `${user.id} ${user.name}`.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()))
    return html`
      <h1>Gestión de cuentas</h1>
      <p>Asigna un único rol por usuario: Admin, Free o VIP. Los nuevos registros son Free. El usuario ID 2 conserva siempre Admin.</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : ''}
      ${this.busy ? html`<p role="status">Procesando…</p>` : ''}
      <label>Buscar usuario por nombre o ID<input type="search" .value=${this.search}
        @input=${(event) => { this.search = event.target.value }} /></label>
      <button type="button" @click=${this.load} ?disabled=${this.busy}>Actualizar lista</button>
      <ul>${users.map((user) => html`<li>
        <form @submit=${(event) => this.save(event, user)}>
          <div class="identity"><strong>${user.name}</strong><small>ID ${user.id} · ${userRoleLabel(user.role)}</small></div>
          <label>Rol de ${user.name}<select name="role" ?disabled=${this.busy || user.id === protectedAdminId}>
            ${userRoles.map(([value, label]) => html`<option value=${value} ?selected=${user.role === value}>${label}</option>`)}
          </select></label>
          <button type="submit" ?disabled=${this.busy || user.id === protectedAdminId}>Guardar rol</button>
        </form>
        <account-removal .userId=${user.id} .userName=${user.name} admin
          @account-removed=${(event) => {
            this.users = this.users.filter((entry) => entry.id !== event.detail.id)
            this.notice = 'Usuario eliminado definitivamente.'
            this.error = event.detail.warning || ''
          }}></account-removal>
        ${user.id === protectedAdminId ? html`<small>Administrador protegido: este rol no se puede quitar.</small>` : ''}
      </li>`)}</ul>
      ${!this.busy && !this.error && !users.length ? html`<p>No hay usuarios coincidentes.</p>` : ''}
    `
  }
}
customElements.define('user-management', UserManagement)
