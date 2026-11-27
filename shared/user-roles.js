export const userRoles = [
  ['admin', 'Admin'],
  ['free', 'Free'],
  ['vip', 'VIP'],
]

export function userRoleLabel(role) {
  return userRoles.find(([value]) => value === role)?.[1] || (role === 'usuario' ? 'Free' : 'Sin rol')
}

export const protectedAdminId = 2
