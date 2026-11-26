ALTER TABLE usuario_enlace_correo
  MODIFY COLUMN proposito ENUM('verify-email', 'reset-recovery', 'reset-password') NOT NULL;
