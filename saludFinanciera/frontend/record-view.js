import { html } from 'lit'

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
  return html`<button class="quiet-button view-toggle" type="button"
    aria-label=${listView ? 'Ver tarjetas' : 'Ver lista'} @click=${toggle}>
    ${listView ? 'Ver tarjetas' : 'Ver lista'}
  </button>`
}
