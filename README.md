# Salud Financiera

## Ejecutar en Windows junto a MySQL

1. Instala Node.js y asegúrate de que MySQL esté iniciado y que exista la base `salud_financiera` con el esquema actual.
2. En PowerShell, desde la raíz del proyecto, ejecuta `Copy-Item .env.example .env`.
3. En `.env`, configura `DB_PASSWORD` con la contraseña local de MySQL. Para generar `SESSION_SECRET`, ejecuta `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copia el resultado. No compartas ni subas `.env`.
4. Ejecuta `npm ci`.
5. Antes del primer arranque con perfiles y recuperación, ejecuta una sola vez `server/migrations/001-user-profile.sql` en tu base existente desde MySQL Workbench u otro cliente MySQL. Amplía `foto_perfil`, normaliza `tema` y agrega el hash de recuperación y la versión de sesión. Haz un respaldo antes de aplicar la migración.
6. En una terminal, ejecuta `npm run server`.
7. En otra terminal, ejecuta `npm run dev`. Abre la dirección local que indique Vite.

El backend verifica la conexión al arrancar. También puedes comprobarla en `http://127.0.0.1:3001/api/health/db`. El endpoint no devuelve las credenciales de conexión.

## Perfil, temas y recuperación

Al registrarse se solicita una foto (archivo JPG, PNG o WebP de hasta 5 MB, o URL HTTPS) y una palabra clave de recuperación. Las fotos locales se reducen a un máximo de 384 píxeles por lado y 256 KB, y se guardan en MySQL; las URL se guardan como referencia y deben seguir disponibles públicamente. La foto aparece junto al nombre al iniciar sesión y al restaurar la sesión.

En **Mi perfil** se puede actualizar la foto y seleccionar **Verde, Azul, Violeta u Oscuro**. Cada cambio de tema se guarda automáticamente en `usuario.tema` y se recupera al volver a entrar, incluido el calendario. Los usuarios existentes pueden configurar su palabra clave desde esta sección, confirmando su contraseña actual.

**Olvidé mi contraseña** solicita usuario, palabra clave y una contraseña nueva. La palabra clave no distingue mayúsculas y se guarda con bcrypt, nunca en texto claro; usa una frase difícil de adivinar y distinta de tu contraseña. El restablecimiento invalida las sesiones anteriores. La recuperación limita los intentos por usuario e IP durante 15 minutos; estos contadores viven en el proceso del backend y requieren un almacén compartido si se despliega más de una instancia.

## Carpetas principales

- `src/inicio`: registro/inicio de sesión y panel web.
- `src/api.js`: cliente HTTP del frontend.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/dashboard.js`: lecturas privadas por usuario y gestión de cuentas.
- `server/movements.js`: registro, edición y eliminación transaccional de movimientos.
- `server/modules.js`: gestión de suscripciones y planes futuros.
- `server/db.js`: pool MySQL configurado con variables de entorno.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. El panel muestra cuentas, tarjetas, suscripciones, planes, movimientos y un calendario mensual con sus reportes. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta” o “crédito”; desde su sección se consultan límite, saldo disponible y fechas de pago, y se puede iniciar un registro de pago como transferencia. Las cuentas se pueden editar y eliminar si no tienen movimientos asociados; su saldo disponible se cambia únicamente mediante movimientos para preservar el historial. El esquema actual no incluye tablas para deudas ni configuración de sugerencias, por lo que esas funciones no se representan como datos persistidos.
