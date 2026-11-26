ALTER TABLE cuenta
  ADD COLUMN fecha_pago_confirmado DATE NULL,
  ADD COLUMN monto_pago_confirmado DECIMAL(15,2) NULL;
