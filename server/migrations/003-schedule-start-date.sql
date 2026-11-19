-- Aplicar una sola vez, con respaldo previo.
-- Los registros anteriores quedan sin fecha hasta capturar su inicio real al editarlos.
ALTER TABLE plan_futuro ADD COLUMN fecha_inicio DATE NULL;
ALTER TABLE suscripciones ADD COLUMN fecha_inicio DATE NULL;
