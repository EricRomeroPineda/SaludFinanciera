import { LitElement, html, css } from 'lit'
import { sectionIcon } from './icons.js'

class SectionPreview extends LitElement {
  static properties = { section: { attribute: false } }
  static styles = css`
    :host { display: block; color: var(--ink); }
    * { box-sizing: border-box; }
    header { position: relative; padding: 28px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 14px; background: var(--soft); color: var(--green); }
    svg { width: 32px; height: 32px; }
    h1 { font-size: clamp(24px, 5vw, 36px); overflow-wrap: anywhere; }
    p { line-height: 1.6; color: var(--muted); }
    .status { position: absolute; top: 16px; right: 16px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 99px; font-size: 11px; color: var(--muted); }
    .notice { padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 18px; margin-top: 20px; }
    article { min-width: 0; padding: 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
    h2 { font-size: 18px; }
    small { color: var(--muted); }
  `
  render() {
    if (!this.section) return ''
    return html`
      <header>
        <span class="icon">${sectionIcon(this.section.icon)}</span>
        <span class="status">En proceso</span>
        <h1>${this.section.name}</h1>
        <p>${this.section.description}</p>
      </header>
      <p class="notice" role="note">Vista previa: estas funciones están en desarrollo. Todavía no se pueden cargar archivos, registrar información ni guardar cambios.</p>
      <div class="features">${this.section.features.map(([title, description]) => html`<article>
        <h2>${title}</h2><p>${description}</p><small>Función prevista · En proceso</small>
      </article>`)}</div>
    `
  }
}
customElements.define('section-preview', SectionPreview)
