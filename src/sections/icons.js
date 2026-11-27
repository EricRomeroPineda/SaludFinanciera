import { svg } from 'lit'

export function sectionIcon(name) {
  const paths = {
    finance: svg`<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-13 5h4"/>`,
    tree: svg`<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v10M5 17v-5h14v5"/>`,
    photos: svg`<rect x="3" y="3" width="15" height="15" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V7M3 14l4-4 7 8m-3-3 3-3 4 4"/><circle cx="13" cy="7" r="1"/>`,
    music: svg`<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>`,
    plant: svg`<path d="M12 21v-9M12 15C4 15 3 10 3 5c6 0 9 3 9 8m0-2c0-6 4-8 9-8 0 6-2 10-9 10M8 21h8"/>`,
    business: svg`<path d="M3 10h18l-2-6H5l-2 6Zm1 0v10h16V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>`,
    admin: svg`<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 10-4m4-2 4 2v4c0 2-2 4-4 5-2-1-4-3-4-5v-4l4-2Z"/>`,
  }
  return svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`
}
