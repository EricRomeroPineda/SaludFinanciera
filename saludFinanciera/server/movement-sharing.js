export const movementSharingFields = `m.id_usuario AS movementOwnerId,
  m.archivo_familiar AS archivedFamily,
  m.id_usuario_destino AS recipientUserId,
  (SELECT nombre FROM usuario WHERE id = m.id_usuario AND m.id_usuario_destino IS NOT NULL) AS senderName,
  (SELECT nombre FROM usuario WHERE id = m.id_usuario_destino) AS recipientName`

export function describeSharedMovement(movement, userId) {
  if (movement.archivedFamily) return {
    ...movement, canEdit: false,
    originAccount: movement.archivedFamily === 'recibida' ? 'Cuenta desvinculada' : movement.originAccount,
    destinationAccount: movement.archivedFamily === 'enviada' ? 'Cuenta desvinculada' : movement.destinationAccount,
  }
  if (!movement.recipientUserId) return movement
  return {
    ...movement,
    canEdit: Number(movement.movementOwnerId) === Number(userId),
    originAccount: `${movement.originAccount} · ${movement.senderName}`,
    destinationAccount: `${movement.destinationAccount} · ${movement.recipientName}`,
  }
}
