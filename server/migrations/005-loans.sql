CREATE TABLE prestamo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario INT UNSIGNED NOT NULL,
  persona VARCHAR(100) NOT NULL,
  tipo ENUM('me_deben', 'debo') NOT NULL,
  monto DECIMAL(15,2) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_compromiso DATE NOT NULL,
  id_cuenta INT UNSIGNED NULL,
  anterior TINYINT(1) NOT NULL DEFAULT 0,
  notas VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY ix_prestamo_usuario (id_usuario),
  CONSTRAINT fk_prestamo_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id),
  CONSTRAINT fk_prestamo_cuenta FOREIGN KEY (id_cuenta) REFERENCES cuenta(id)
) ENGINE=InnoDB;

ALTER TABLE movimiento
  ADD COLUMN id_prestamo INT UNSIGNED NULL,
  ADD COLUMN clase_prestamo ENUM('desembolso', 'abono') NULL,
  ADD KEY ix_movimiento_prestamo (id_prestamo),
  ADD CONSTRAINT fk_movimiento_prestamo
    FOREIGN KEY (id_prestamo) REFERENCES prestamo(id);
