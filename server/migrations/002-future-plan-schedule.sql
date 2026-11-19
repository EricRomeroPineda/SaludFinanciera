-- Aplicar una sola vez, con respaldo previo.
-- Los planes anteriores requieren configurar aportacion y fecha inicial al editarlos.
ALTER TABLE plan_futuro
  ADD COLUMN aportacion_periodo DECIMAL(15,2) NULL,
  ADD COLUMN fecha_primera_aportacion DATE NULL;

UPDATE plan_futuro AS p
SET monetizado = (
  SELECT COALESCE(SUM(m.monto), 0)
  FROM movimiento AS m
  WHERE m.id_plan_futuro = p.id AND m.id_usuario = p.id_usuario
);
