# Salud Financiera

## Ejecutar en Windows junto a MySQL

1. Instala Node.js y asegúrate de que MySQL esté iniciado y que exista la base `salud_financiera` con el esquema actual.
2. En PowerShell, desde la raíz del proyecto, ejecuta `Copy-Item .env.example .env`.
3. En `.env`, configura `DB_PASSWORD` con la contraseña local de MySQL. Para generar `SESSION_SECRET`, ejecuta `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copia el resultado. No compartas ni subas `.env`.
4. Ejecuta `npm ci`.
5. Si necesitas normalizar los temas existentes, ejecuta `server/migrations/001-user-profile.sql` desde MySQL Workbench u otro cliente MySQL. No agrega columnas ni modifica `foto_perfil VARCHAR(500)`. Haz un respaldo antes de aplicar la migración.
6. En una terminal, ejecuta `npm run server`.
7. En otra terminal, ejecuta `npm run dev`. Abre la dirección local que indique Vite.

El backend verifica la conexión al arrancar. También puedes comprobarla en `http://127.0.0.1:3001/api/health/db`. El endpoint no devuelve las credenciales de conexión.

## Perfil, temas y recuperación

La barra de secciones no muestra Calendario ni Mi perfil para ahorrar espacio. El perfil sigue disponible al pulsar el nombre o la foto del usuario en la barra superior.

Al iniciar sesión o restaurar una sesión se muestra un **Menú principal** con la opción **Salud financiera**, que abre el panel existente (Panorama, Tarjetas y las demás pestañas). Desde el panel se puede volver al menú. La barra superior agrupa la foto y el nombre del usuario autenticado junto a **Cerrar sesión** en ambas pantallas; al pulsar el perfil se abre **Mi perfil**. Si falta la URL o no carga, se muestra una imagen de perfil genérica, no una inicial.

Al registrarse se solicita la URL HTTPS de una foto (máximo 500 caracteres) y una palabra clave de recuperación. Solo se guarda la URL en `foto_perfil VARCHAR(500)`, no se suben archivos ni se admiten imágenes base64. La URL debe seguir disponible públicamente. La foto aparece junto al nombre al iniciar sesión y al restaurar la sesión. No es necesario ampliar el campo de foto; si ya lo ampliaste, puede conservarse sin cambios.

En **Mi perfil** se puede actualizar la foto y seleccionar **Verde, Azul, Violeta u Oscuro**. Cada cambio de tema se guarda automáticamente en `usuario.tema` y se recupera al volver a entrar, incluido el calendario. Los usuarios existentes pueden configurar su palabra clave desde esta sección, confirmando su contraseña actual.

El botón con sol/luna alterna la **vista Día/Noche** sin cambiar `usuario.tema` ni hacer solicitudes a la base de datos. Cada tema tiene una paleta clara y otra nocturna: verde, azul y violeta conservan sus matices con fondos oscuros; Oscuro usa negro casi puro de noche y grises claros de día. Se aplica a menús, formularios, paneles, mensajes y calendario mediante variables CSS compartidas que también pueden utilizar las nuevas secciones. La vista se mantiene durante la sesión de navegación; al entrar de nuevo o seleccionar un tema, Oscuro comienza en Noche y los demás en Día.

La tabla `usuario` utiliza los campos existentes `id`, `nombre`, `password_hash`, `recuperacion_token_hash`, `recuperacion_expira`, `foto_perfil` y `tema`. Las solicitudes JSON tienen un límite de 16 KB; el login solo envía usuario y contraseña, sin reenviar la foto.

El registro y **Guardar perfil** leen la URL directamente del formulario y la guardan en `usuario.foto_perfil`. La edición llama a `PUT /api/users/:id/profile` con el ID del usuario conectado; el backend comprueba que coincida con la sesión y ejecuta el `UPDATE usuario ... WHERE id = ?`. Después consulta ese mismo registro para devolver la foto guardada. La ruta anterior `PUT /api/auth/profile` sigue disponible. `npm run server` recarga el backend cuando cambia su código. Si aparece «Ruta no encontrada» en una operación de perfil, detén el proceso anterior y vuelve a ejecutar `npm run server` desde este proyecto.

**Olvidé mi contraseña** solicita usuario, palabra clave y una contraseña nueva. La palabra clave no distingue mayúsculas y se guarda con bcrypt en `recuperacion_token_hash`, nunca en texto claro; `recuperacion_expira` queda en `NULL` al configurarla porque es una clave permanente, no un enlace temporal. Los valores con expiración vencida o hashes de tokens antiguos no sirven como palabra clave; configura una desde **Mi perfil**. Usa una frase difícil de adivinar y distinta de tu contraseña. Las sesiones están vinculadas mediante HMAC al hash de contraseña, por lo que un restablecimiento invalida las sesiones anteriores sin requerir otra columna; las sesiones del formato anterior deberán iniciar sesión de nuevo. La recuperación limita los intentos por usuario e IP durante 15 minutos; estos contadores viven en el proceso del backend y requieren un almacén compartido si se despliega más de una instancia.

## Carpetas principales

- `saludFinanciera/`: módulo financiero completo, separado del login y del orquestador.
- `saludFinanciera/frontend/`: componente `salud-financiera`, flujo financiero, estilos propios y calendario conservado sin pestaña visible.
- `saludFinanciera/server/`: rutas y consultas de panorama/cuentas, movimientos, suscripciones, planes y calendario. Conserva las URL `/api/dashboard`, `/api/accounts`, `/api/movements`, `/api/subscriptions`, `/api/plans` y `/api/calendar`.
- `saludFinanciera/suscripciones/`: formulario y tarjetas de suscripciones, estilos, rutas y servicio MySQL de este flujo.
- `src/inicio/inicio.js`: orquestador de menú, login/registro, perfil y barra de usuario; monta el módulo financiero.
- `src/inicio/appearance.css`: paletas compartidas y vista Día/Noche; sus variables se heredan en los módulos.
- `src/api.js`: cliente HTTP del frontend.
- `server/index.js`: orquestador HTTP; autentica y delega las rutas financieras al módulo.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/db.js`: pool MySQL configurado con variables de entorno.

La barra financiera muestra **Panorama, Tarjetas, Planes futuros, Registro de movimientos, Suscripciones y Deudores**. Deudores es un estado vacío preparado para desarrollo posterior: no registra ni guarda datos. Cuentas ya no ocupa una pestaña; su gestión se conserva desde **Panorama → Cuentas → Ver todas** y desde la creación de tarjetas.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. Los datos se cargan al entrar al módulo, no al iniciar sesión ni al abrir el perfil. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta” o “crédito”; desde su sección se consultan límite, saldo disponible y fechas de pago, y se puede iniciar un registro de pago como transferencia. Las cuentas se pueden editar y eliminar si no tienen movimientos asociados; su saldo disponible se cambia únicamente mediante movimientos para preservar el historial.

Al desplegar esta reorganización, copia también `saludFinanciera/` junto a `server/` y `src/`, y reinicia el backend: las consultas financieras ya no están en los archivos antiguos de `server/`.

## Suscripciones

En **Suscripciones → Agregar suscripción** se captura nombre, tipo (`servicio` o `suscripcion`), costo por cobro, frecuencia, día de cobro, tipo de pago y estado. La frecuencia semanal permite elegir lunes–domingo (se guarda 1–7 en `dia_cobro`); las demás usan día del mes (1–31). El costo mensual se calcula automáticamente tanto en la vista previa como en el backend y no admite captura manual. El anual estimado es costo por cobro multiplicado por 52 para semanal, 12 para mensual, 4 para trimestral, 2 para semestral o 1 para anual; para frecuencias no semanales, el mensual es ese anual dividido entre 12, redondeado a centavos. La estimación semanal usa 52 cobros, no fechas exactas de calendario. El anual se calcula directamente, no multiplicando el mensual redondeado.

Las tarjetas muestran costo por cobro y estatus arriba, estimación de un año, costo mensual, monetizado hasta el momento y día de cobro. Su altura se adapta al contenido para evitar desbordamientos. `tipo_pago` guarda `manual` o `automatico` (mostrado como **Automático (domiciliado)**); ya no se capturan ni muestran imágenes. Los valores anteriores se muestran como «Sin definir» hasta elegir una opción al editar. No se modifica la tabla. Los costos se recalculan también al leer registros anteriores; `costo_mensual` se guarda calculado al crear o editar.

El indicador calcula los días desde la fecha local actual: semanal busca la siguiente aparición del día elegido, y mensual el próximo día del mes (ajustado al último día si el mes es más corto). Si coincide con hoy muestra **¡Hoy es día de pagar!**; las suscripciones inactivas no muestran avisos de pago. Se actualiza cada minuto mientras la sección está abierta. Para frecuencias trimestrales, semestrales y anuales se muestra una referencia al próximo día configurado, aclarando que no se conoce el mes de inicio del periodo.

**Monetizado** no se captura manualmente: es la suma de `movimiento.monto` donde `movimiento.id_suscripcion = suscripciones.id` y ambos registros pertenecen al mismo usuario. Se incluyen todos los movimientos relacionados, sin limitarse a los 250 del historial. Las lecturas calculan el total incluso para movimientos anteriores; al crear, editar, reasignar o eliminar un movimiento se sincroniza también `suscripciones.monetizado` en la misma transacción, actualizando tanto la suscripción anterior como la nueva si cambia la relación. Una suscripción nueva inicia en cero. Usa **Registro de movimientos** para vincular un movimiento a una suscripción.

Las tarjetas de frecuencia mensual omiten el detalle «Costo mensual», ya que repite el costo por cobro. El aviso de días faltantes tiene un contenedor y texto destacados en azul, o en color de alerta cuando faltan dos días o menos, adaptados al modo día/noche.

Para frecuencia semanal, el costo mensual usa **costo por cobro × 4 semanas**, mientras la estimación anual conserva **costo por cobro × 52 semanas**. Por eso el anual semanal no equivale al mensual multiplicado por 12.

Las tarjetas permiten editar y muestran un botón de papelera que abre un modal de confirmación antes de eliminar; si existen movimientos asociados se cancela la suscripción en lugar de eliminar su historial. El flujo conserva los campos y las tablas existentes, sin migraciones adicionales. Al desplegar, actualiza tanto `saludFinanciera/suscripciones/` como los archivos del módulo financiero que la integran y reinicia el backend.
