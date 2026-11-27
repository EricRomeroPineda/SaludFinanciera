ALTER TABLE movimiento
  ADD COLUMN id_usuario_destino INT UNSIGNED NULL,
  ADD KEY ix_movimiento_usuario_destino (id_usuario_destino),
  ADD CONSTRAINT fk_movimiento_usuario_destino
    FOREIGN KEY (id_usuario_destino) REFERENCES usuario(id);
