ALTER TABLE usuario
  ADD COLUMN correo VARCHAR(254) NULL,
  ADD COLUMN correo_verificado TINYINT(1) NOT NULL DEFAULT 0,
  ADD UNIQUE KEY uq_usuario_correo (correo);

CREATE TABLE usuario_enlace_correo (
  id_usuario INT NOT NULL,
  proposito ENUM('verify-email', 'reset-recovery') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  expira DATETIME NOT NULL,
  PRIMARY KEY (id_usuario, proposito),
  UNIQUE KEY uq_enlace_token (token_hash)
);
