const hues = { verde: 156, azul: 218, violeta: 277, turquesa: 181, rosa: 330, naranja: 25, rojo: 0, dorado: 44, oscuro: 220 }

export function accountThemeStyle(account) {
  if (!Object.hasOwn(hues, account.ownerTheme)) return ''
  const hue = hues[account.ownerTheme]
  const night = account.ownerAppearance === 'night'
  if (account.ownerTheme === 'oscuro') {
    return night
      ? '--surface:#15171a;--soft:#22252a;--ink:#eef0f3;--muted:#b3b8c2;--line:#525863;--green:#c0c5ce'
      : '--surface:#fff;--soft:#f3f4f6;--ink:#272a2e;--muted:#555b66;--line:#b7bcc5;--green:#474d57'
  }
  return `--surface:hsl(${hue} ${night ? '48% 17%' : '58% 94%'});`
    + `--soft:hsl(${hue} ${night ? '48% 24%' : '54% 87%'});`
    + `--ink:hsl(${hue} ${night ? '15% 93%' : '48% 16%'});`
    + `--muted:hsl(${hue} 12% ${night ? '73%' : '38%'});`
    + `--line:hsl(${hue} ${night ? '48% 35%' : '35% 74%'});`
    + `--green:hsl(${hue} 56% ${night ? '76%' : '30%'})`
}
