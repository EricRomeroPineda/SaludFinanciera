-- Aplicar una sola vez. No ejecutar si ya agregaste estas dos columnas.
ALTER TABLE plan_futuro
  ADD COLUMN dia_aportacion TINYINT UNSIGNED NULL,
  ADD COLUMN aportacion_periodo DECIMAL(15,2) NULL;
