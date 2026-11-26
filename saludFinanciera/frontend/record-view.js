import { html, svg } from 'lit'

export function addIcon() {
  return html`<svg class="add-icon" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>`
}

export function editIcon() {
  return html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false"><path d="m16 3 5 5L8 21H3v-5L16 3Zm-3 3 5 5" /></svg>`
}

export function sortByDue(items, dueValue) {
  return items.map((item) => {
    const due = dueValue(item)
    return { item, due: Number.isFinite(due) ? due : Infinity }
  }).sort((a, b) => (a.due === b.due ? 0 : a.due - b.due)
    || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'es')
    || Number(a.item.id) - Number(b.item.id))
    .map(({ item }) => item)
}

export function viewToggle(listView, toggle) {
  const label = listView ? 'Ver tarjetas' : 'Ver lista'
  return html`<button class="quiet-button view-toggle" type="button"
    aria-label=${label} title=${label} @click=${toggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${listView ? svg`
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      ` : svg`
        <path d="M8 5h13M8 12h13M8 19h13" />
        <path d="M3 5h.01M3 12h.01M3 19h.01" />
      `}
    </svg>
  </button>`
}
