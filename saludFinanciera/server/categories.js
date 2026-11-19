import { pool } from '../../server/db.js'
import { invalid, requiredText } from './validation.js'

export async function createCategory(input) {
  const name = requiredText(input.name, 'El nombre de la categoría', 100)
  const type = input.type
  if (!['ingreso', 'gasto'].includes(type)) throw invalid('Selecciona una categoría de ingreso o gasto.')
  const [existing] = await pool.execute(
    'SELECT id FROM categorias WHERE id_ahorros IS NULL AND nombre = ? AND tipo = ? LIMIT 1',
    [name, type],
  )
  if (existing.length) throw invalid('Ya existe una categoría con ese nombre y tipo.', 409)
  const [result] = await pool.execute(
    'INSERT INTO categorias (id_ahorros, nombre, tipo) VALUES (NULL, ?, ?)',
    [name, type],
  )
  return { category: { id: result.insertId, name, type } }
}
