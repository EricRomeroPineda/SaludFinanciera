export function movementLabel(item) {
  if (item.recipientUserId) return 'Transferencia familiar'
  if (item.loanId) return `${item.loanKind === 'desembolso' ? 'Préstamo inicial' : 'Abono a préstamo'} · ${item.loanName || 'Préstamo'}`
  return item.originAccountId && item.destinationAccountId ? 'Transferencia' : item.originAccountId ? 'Gasto' : 'Ingreso'
}

export function movementOrigin(item) {
  return item.originAccount || (item.loanId && item.destinationAccountId ? `Préstamo · ${item.loanName}` : '—')
}

export function movementDestination(item) {
  return item.destinationAccount || (item.loanId && item.originAccountId ? `Préstamo · ${item.loanName}` : '—')
}
