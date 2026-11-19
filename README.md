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
- `saludFinanciera/frontend/`: componente `salud-financiera`, flujo financiero, estilos propios y calendario integrado en Movimiento.
- `saludFinanciera/server/`: rutas y consultas de panorama/cuentas, movimientos, suscripciones, planes y calendario. Conserva las URL `/api/dashboard`, `/api/accounts`, `/api/movements`, `/api/subscriptions`, `/api/plans` y `/api/calendar`.
- `saludFinanciera/suscripciones/`: formulario y tarjetas de suscripciones, estilos, rutas y servicio MySQL de este flujo.
- `src/inicio/inicio.js`: orquestador de menú, login/registro, perfil y barra de usuario; monta el módulo financiero.
- `src/inicio/appearance.css`: paletas compartidas y vista Día/Noche; sus variables se heredan en los módulos.
- `src/api.js`: cliente HTTP del frontend.
- `server/index.js`: orquestador HTTP; autentica y delega las rutas financieras al módulo.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/db.js`: pool MySQL configurado con variables de entorno.

La barra financiera muestra **Panorama, Movimiento, Tarjetas, Planes futuros, Suscripciones y Deudores**. Deudores es un estado vacío preparado para desarrollo posterior: no registra ni guarda datos. Cuentas ya no ocupa una pestaña; su gestión se conserva desde **Panorama → Cuentas → Ver todas** y desde la creación de tarjetas.

Al seleccionar una tarjeta bancaria o una suscripción, aparece debajo una tabla con fecha, operación, origen, destino, categoría, suscripción y monto. En tarjetas bancarias se pulsa la tarjeta (o se usa Enter/Espacio al enfocarla), sin botón «Ver movimientos»; las suscripciones conservan ese botón adicional. Las tarjetas bancarias incluyen movimientos donde su cuenta es origen o destino; las suscripciones incluyen los vinculados por `id_suscripcion`. Se consulta todo el historial relacionado del usuario autenticado, sin el límite de 250 del panorama. Si no existen registros se muestra **No hay movimientos**; los errores de consulta se muestran con opción de reintentar.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. Los datos se cargan al entrar al módulo, no al iniciar sesión ni al abrir el perfil. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta”, “crédito” o “débito” (también sin acentos). Las cuentas se pueden editar; solo se pueden eliminar si no tienen movimientos asociados. El saldo disponible se puede corregir directamente al editar tanto crédito como débito; esta corrección actualiza `cuenta.disponible` sin crear ni modificar movimientos. Los movimientos posteriores siguen ajustando el saldo.

El formulario de tarjetas ofrece **Crédito**, **Débito** y **Efectivo**. En crédito se capturan nombre, límite máximo (`total`), crédito libre (`disponible`), fecha de corte, fecha límite de pago y pago para no generar intereses de este mes. La deuda se calcula como **Saldo utilizado = total − disponible**, sin una columna adicional, y el disponible no puede superar el límite al registrar o editar. Débito y Efectivo solo requieren nombre, tipo y saldo disponible; límite y datos de pago de crédito se guardan como `NULL`. Los tres tipos destacan el **Saldo disponible** como dato principal; solo crédito muestra límite, saldo utilizado, fechas y pago del mes, y permite iniciar el pago como transferencia.

El campo Tipo siempre es un selector con Crédito, Débito y Efectivo, tanto desde Tarjetas como desde Cuentas, al crear o editar. El backend rechaza otros tipos al guardar; los registros antiguos se conservan y requieren elegir una de estas opciones al editarlos. Efectivo aparece junto a Nómina / Débito y conserva las mismas acciones e historial. Se guarda como `cuenta.tipo = 'Efectivo'`; si esa columna usa un ENUM en tu instalación, debe admitir ese valor conservando sus opciones anteriores.

Al registrar crédito se capturan explícitamente **Crédito total (límite máximo)** y **Crédito disponible (sin utilizar)**. Ambos valores se guardan tal como se capturan en `total` y `disponible`, respectivamente; un disponible vacío se rechaza, no se sustituye por cero. Por ejemplo, total 10 000 y disponible 7 000 producen una deuda calculada de 3 000, sin cambiar los valores guardados.

El visor bancario usa el mismo formato visual de Suscripciones: cuadrícula adaptable de tarjetas compactas, fondo del tema, sombra, bordes redondeados y acciones al pie. La altura crece con el contenido y se mantiene el detalle de movimientos debajo de la cuadrícula al seleccionar una tarjeta.

Las tarjetas se separan en dos mitades: **Nómina / Débito** a la izquierda y **Crédito** a la derecha; en móvil se apilan. La papelera solicita confirmación y mantiene la restricción de no eliminar cuentas con movimientos. Solo crédito muestra una barra de **disponible / límite máximo**: verde por encima de 50 %, azul entre más de 20 % y 50 %, y alerta hasta 20 %. Si el límite no permite calcular un porcentaje se solicita configurarlo. El aviso de pago usa la fecha límite registrada y la fecha local actual, se actualiza cada minuto y distingue días restantes, vencimiento hoy y fecha vencida; no adelanta automáticamente la fecha al mes siguiente ni determina si ya se cubrió el pago.

Al desplegar esta reorganización, copia también `saludFinanciera/` junto a `server/` y `src/`, y reinicia el backend: las consultas financieras ya no están en los archivos antiguos de `server/`.

## Movimiento y calendario

Movimiento está junto a Panorama. El calendario navega por mes y permite seleccionar un día para consultar cuántos movimientos se registraron, sus ingresos/gastos y su detalle. **Registrar movimiento en este día** abre un modal con esa fecha; **Nuevo movimiento** usa hoy. El modal permite gasto, ingreso y transferencia, con sus cuentas, categoría y relaciones existentes. Los accesos desde tarjetas y planes también abren este modal. Guardar o eliminar actualiza el calendario, el resumen diario y el registro mensual sin perder el mes seleccionado.

La leyenda distingue **azul: pago de tarjeta**, **verde: aportación a plan**, **violeta: suscripción/servicio**. Los puntos son fechas previstas, no pagos realizados; el número del día cuenta únicamente movimientos reales. Al seleccionar un día, sus compromisos previstos tienen un botón Registrar que precarga la fecha y la relación correspondiente: plan o suscripción como gasto, pago de tarjeta como transferencia hacia la tarjeta. El usuario confirma cuenta de origen e importe antes de guardar. No se crean movimientos automáticamente.

Las tarjetas de crédito usan su fecha límite exacta registrada, sin repetirla artificialmente cada mes ni inferir que esté pagada. Los planes pendientes y configurados muestran el día semanal/mensual desde su fecha de inicio, independientemente de Mostrar en Panorama; las suscripciones activas muestran su día de cobro desde su inicio. Los días 29–31 se ajustan al último día del mes cuando es necesario. Las frecuencias trimestrales, semestrales y anuales usan el mes de inicio como ancla, avanzando 3, 6 o 12 meses. Si el día de cobro de ese primer mes es anterior al inicio, el primer marcador pasa al siguiente periodo. Solo los registros antiguos sin fecha de inicio conservan la referencia mensual con aviso. Los marcadores se generan con la configuración actual, no son un historial de cuotas.

Debajo aparece **Registro general**, por defecto con todos los movimientos del usuario conectado, sin filtro de categoría ni límite de 250. El selector permite consultar opcionalmente el **año seleccionado** o el **mes seleccionado**; el calendario incorpora un campo para cambiar directamente de año y un botón Actualizar registros. La tabla incluye fecha guardada en `movimiento.fecha`, operación, origen, destino, categoría, plan, suscripción, monto y acciones de editar/eliminar. Pulsar la fecha de una fila abre ese día en el calendario, incluso si pertenece a otro mes o año. El backend conserva siempre el filtro del usuario autenticado; los contadores diarios y categorías del calendario corresponden al mes visible. La fecha usada es la capturada en el formulario, no una fecha de creación adicional. Los errores muestran opción de reintentar, no se presentan como registros vacíos.

**Registrar categoría**, tanto en Movimiento como dentro del modal, solicita nombre y tipo ingreso/gasto. Usa `POST /api/categories` autenticado y las columnas existentes `id`, `id_ahorros`, `nombre`, `tipo`, insertando `id_ahorros = NULL`. Las categorías son **compartidas**, como el catálogo existente; no se presume una columna de usuario que la tabla no tiene. Se rechazan nombres vacíos, tipos inválidos y duplicados con el mismo nombre/tipo en el catálogo sin ahorro. Las nuevas categorías se incorporan al selector del formulario (filtrado por operación); no requieren migración.

## Planes futuros

### Fecha de inicio de planes y suscripciones

Antes de ejecutar esta versión, respalda la base y aplica una sola vez `server/migrations/003-schedule-start-date.sql`: agrega `fecha_inicio DATE NULL` a `plan_futuro` y `suscripciones`. No repitas el SQL si ya agregaste las columnas. La fecha es obligatoria al crear o editar ambos formularios y se muestra en sus tarjetas. Los registros anteriores quedan en NULL para no inventar una fecha histórica: conservan su comportamiento previo y un aviso para configurar el inicio real al editarlos.

El calendario no genera marcadores anteriores al inicio configurado. Por ejemplo, un plan semanal de lunes que inicia el miércoles 18 de noviembre de 2026 aparece por primera vez el lunes 23, no los lunes anteriores. La proyección y los días faltantes tampoco comienzan antes del inicio. Los planes siguen teniendo marcadores en los periodos siguientes hasta completar realmente la meta; no se limitan a un número fijo de lunes desde el inicio. La fecha estimada se recalcula con el pendiente y las próximas aportaciones. Los movimientos ya guardados siguen apareciendo por su propia `movimiento.fecha` y siguen contando en el monetizado, incluso si son anteriores al inicio; no se borra ni oculta historial.

Al pulsar Editar en planes o suscripciones, la pantalla se desplaza al formulario y enfoca **Fecha de inicio**, situado al principio. Esto también permite completar registros antiguos cuya fecha aún está vacía.

El visor usa tarjetas con **meta fija, monetizado, faltante y barra de progreso**. La meta solo cambia si se modifica explícitamente al editar, nunca por aportaciones ni atrasos. El progreso es monetizado / meta, limitado visualmente a 100 %; el faltante conserva la resta meta − monetizado, incluso si hay un excedente. Mostrar en el panorama controla qué tarjetas aparecen también en Panorama; todos los planes siguen disponibles en Planes futuros.

Monetizado es exclusivamente la suma de todos los `movimiento.monto` vinculados por `id_plan_futuro` y por el mismo usuario, sin el límite de 250 del historial. No admite captura manual. Al crear, editar, reasignar o eliminar movimientos se sincroniza `plan_futuro.monetizado` en la misma transacción; las lecturas también calculan la suma para incluir registros anteriores. Las aportaciones se registran como gasto desde una cuenta en Movimiento, seleccionando el plan.

Al crear o editar se capturan nombre, monto objetivo, frecuencia semanal o mensual, **aportación por periodo** y **día de aportación**. Semanal muestra lunes–domingo y guarda 1–7 en `dia_aportacion`; mensual solicita un número del 1 al 31. El importe positivo se guarda en `aportacion_periodo DECIMAL(15,2)`. Los periodos faltantes se calculan como `ceil(max(meta − monetizado, 0) / aportacion_periodo)`, sin captura manual ni uso del valor antiguo de `periodos_faltantes`. La columna anterior queda sin uso; el dato actualizado se calcula al consultar, no se guarda allí.

La fecha estimada distribuye el pendiente en las próximas fechas del día elegido. Hoy cuenta si todavía no se registró una aportación hoy; si ya se aportó, se proyecta la siguiente cuota después del último movimiento vinculado. Si pasa un día programado y aún falta dinero, la estimación se recorre al siguiente periodo. Una aportación insuficiente puede requerir otro periodo; una mayor reduce los periodos necesarios. Se pueden registrar varios abonos para completar una cuota. No se crean cargos automáticos ni se guarda un historial de cuotas incumplidas. Los meses cortos usan su último día y recuperan el día configurado en los meses siguientes. Ejemplo: $950 pendientes / $200 mensuales = cinco aportaciones, con la última de $150. La proyección se actualiza al consultar y cada minuto en pantalla. Al completar la meta muestra cero periodos y omite futuras fechas.

Panorama muestra solo un resumen compacto de hasta cuatro planes visibles: nombre, monetizado / meta y barra con porcentaje. El nombre abre el plan seleccionado en Planes futuros; **Ver todos** lleva a esa sección. Las fechas, avisos, acciones e historial quedan en Planes futuros para no duplicar la pantalla completa.

Las tarjetas de Planes futuros muestran los días hasta la próxima aportación, con el mismo aviso azul de Suscripciones y alerta cuando faltan dos días o menos; hoy muestra **¡Hoy es día de aportar!**. El botón **Registrar movimiento** abre Movimiento como gasto con el plan preseleccionado. Al pulsar una tarjeta (o Enter/Espacio con foco) aparece debajo la tabla de todos sus movimientos, sin límite de 250, filtrados por `id_plan_futuro` y usuario. La tabla se actualiza al recargar los datos después de guardar movimientos. La papelera abre un modal de confirmación; los planes con movimientos no se pueden eliminar y el error se muestra sin borrar el historial.

**Requiere `dia_aportacion` y `aportacion_periodo`.** Si aún no existen, respalda la base y aplica una sola vez `server/migrations/002-future-plan-schedule.sql`. No lo repitas si ya agregaste ambas columnas manualmente. No requiere fecha inicial ni modifica la columna generada `faltante`. Los planes anteriores sin aportación/día, incluidos los anuales, se muestran con aviso para configurar frecuencia semanal o mensual al editarlos. Reinicia el backend y despliega también `saludFinanciera/plan-calculations.js`.

## Suscripciones

En **Suscripciones → Agregar suscripción** se captura nombre, tipo (`servicio` o `suscripcion`), costo por cobro, frecuencia, día de cobro, tipo de pago y estado. La frecuencia semanal permite elegir lunes–domingo (se guarda 1–7 en `dia_cobro`); las demás usan día del mes (1–31). El costo mensual se calcula automáticamente tanto en la vista previa como en el backend y no admite captura manual. El anual estimado es costo por cobro multiplicado por 52 para semanal, 12 para mensual, 4 para trimestral, 2 para semestral o 1 para anual; para frecuencias no semanales, el mensual es ese anual dividido entre 12, redondeado a centavos. La estimación semanal usa 52 cobros, no fechas exactas de calendario. El anual se calcula directamente, no multiplicando el mensual redondeado.

Las tarjetas muestran costo por cobro y estatus arriba, estimación de un año, costo mensual, monetizado hasta el momento y día de cobro. Su altura se adapta al contenido para evitar desbordamientos. `tipo_pago` guarda `manual` o `automatico` (mostrado como **Automático (domiciliado)**); ya no se capturan ni muestran imágenes. Los valores anteriores se muestran como «Sin definir» hasta elegir una opción al editar. No se modifica la tabla. Los costos se recalculan también al leer registros anteriores; `costo_mensual` se guarda calculado al crear o editar.

El indicador calcula los días desde la fecha local actual hasta el siguiente cobro a partir de la fecha de inicio: semanal busca la siguiente aparición del día elegido, y las otras frecuencias usan el día del mes (ajustado al último día si es más corto) y su intervalo de meses. Si coincide con hoy muestra **¡Hoy es día de pagar!**; las suscripciones inactivas no muestran avisos de pago. Se actualiza cada minuto mientras la sección está abierta. Solo para registros antiguos sin inicio se mantiene la referencia al próximo día configurado, aclarando que no se conoce el mes inicial.

**Monetizado** no se captura manualmente: es la suma de `movimiento.monto` donde `movimiento.id_suscripcion = suscripciones.id` y ambos registros pertenecen al mismo usuario. Se incluyen todos los movimientos relacionados, sin limitarse a los 250 del historial. Las lecturas calculan el total incluso para movimientos anteriores; al crear, editar, reasignar o eliminar un movimiento se sincroniza también `suscripciones.monetizado` en la misma transacción, actualizando tanto la suscripción anterior como la nueva si cambia la relación. Una suscripción nueva inicia en cero. Usa **Movimiento** para vincular un movimiento a una suscripción.

Las tarjetas de frecuencia mensual omiten el detalle «Costo mensual», ya que repite el costo por cobro. El aviso de días faltantes tiene un contenedor y texto destacados en azul, o en color de alerta cuando faltan dos días o menos, adaptados al modo día/noche.

Para frecuencia semanal, el costo mensual usa **costo por cobro × 4 semanas**, mientras la estimación anual conserva **costo por cobro × 52 semanas**. Por eso el anual semanal no equivale al mensual multiplicado por 12.

Las tarjetas permiten editar y muestran un botón de papelera que abre un modal de confirmación antes de eliminar; si existen movimientos asociados se cancela la suscripción en lugar de eliminar su historial. Al desplegar, aplica la migración de fecha de inicio indicada arriba, actualiza `saludFinanciera/schedule.js`, `saludFinanciera/suscripciones/` y los archivos del módulo financiero que la integran y reinicia el backend.
