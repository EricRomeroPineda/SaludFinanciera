# Salud Financiera

## Ejecutar en Windows junto a MySQL

1. Instala Node.js y asegúrate de que MySQL esté iniciado y que exista la base `salud_financiera` con el esquema actual.
2. En PowerShell, desde la raíz del proyecto, ejecuta `Copy-Item .env.example .env`.
3. En `.env`, configura `DB_PASSWORD` con la contraseña local de MySQL. Para generar `SESSION_SECRET`, ejecuta `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copia el resultado. No compartas ni subas `.env`.
4. Ejecuta `npm ci`.
5. En una terminal, ejecuta `npm run server`.
6. En otra terminal, ejecuta `npm run dev`. Abre la dirección local que indique Vite.

El backend verifica la conexión al arrancar. También puedes comprobarla en `http://127.0.0.1:3001/api/health/db`. El endpoint no devuelve las credenciales de conexión.

## Carpetas principales

- `src/inicio`: registro/inicio de sesión y panel web.
- `src/api.js`: cliente HTTP del frontend.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/dashboard.js`: lecturas privadas por usuario y gestión de cuentas.
- `server/movements.js`: registro, edición y eliminación transaccional de movimientos.
- `server/modules.js`: gestión de suscripciones y planes futuros.
- `server/db.js`: pool MySQL configurado con variables de entorno.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. El panel muestra cuentas, tarjetas, suscripciones, planes, movimientos y un calendario mensual con sus reportes. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta” o “crédito”; desde su sección se consultan límite, saldo disponible y fechas de pago, y se puede iniciar un registro de pago como transferencia. Las cuentas se pueden editar y eliminar si no tienen movimientos asociados; su saldo disponible se cambia únicamente mediante movimientos para preservar el historial. El esquema actual no incluye tablas para deudas ni configuración de sugerencias, por lo que esas funciones no se representan como datos persistidos.
