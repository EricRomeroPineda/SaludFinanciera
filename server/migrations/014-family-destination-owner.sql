ALTER TABLE movimiento
  DROP FOREIGN KEY movimiento_ibfk_6,
  ADD COLUMN id_propietario_destino INT UNSIGNED
    GENERATED ALWAYS AS (COALESCE(id_usuario_destino, id_usuario)) STORED,
  ADD KEY ix_movimiento_propietario_destino (id_propietario_destino, id_cuenta_destino),
  ADD CONSTRAINT fk_movimiento_cuenta_destino
    FOREIGN KEY (id_propietario_destino, id_cuenta_destino)
    REFERENCES cuenta (id_usuario, id);
