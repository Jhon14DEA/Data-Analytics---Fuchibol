# FUT Analytics — recuperación del entorno

Validación local: 5 de octubre de 2026, Windows. No se modificaron código de aplicación, BET_SCORE, reglas LIVE, probabilidades, esquema Prisma, migraciones ni versiones del lockfile.

## Compilar y ejecutar

Desde PowerShell, en esta carpeta, con Docker Desktop iniciado:

```powershell
.\fut.cmd build
.\fut.cmd start
```

Abrir http://127.0.0.1:3000. Para desarrollo, detener el servidor con Ctrl+C y ejecutar:

```powershell
.\fut.cmd dev
```

`fut.cmd` selecciona Node 22, comprueba su versión, levanta PostgreSQL y espera su healthcheck antes de ejecutar el script npm. No instala dependencias ni ejecuta migraciones automáticamente. Los servidores escuchan solamente en localhost. No cambia la política de PowerShell. Después de usar `dev`, ejecutar `build` antes de volver a `start`.

## Versiones verificadas

| Componente | Versión / estado |
| --- | --- |
| Node utilizado para FUT | 22.23.2 LTS, instalado con WinGet para el usuario |
| npm utilizado para FUT | 10.9.8, incluido con Node 22 |
| Git for Windows | 2.55.0.windows.5 |
| Next.js | 15.5.23 |
| React | 19.2.8 |
| TypeScript | 5.9.3 |
| Prisma / Prisma Client | 6.19.3 |
| Tailwind CSS | 3.4.19 |
| Docker Engine | 29.8.1 |
| Docker Compose | 5.5.1 |
| WSL | 3.0.1; docker-desktop activo con WSL2 |
| PostgreSQL | 16.15; imagen postgres:16-alpine |

Las versiones JavaScript proceden de `package-lock.json`, formato 3. No existe registro que permita afirmar con qué versión exacta de Node se creó originalmente el proyecto. Node 22 es compatible con Prisma 6 y las dependencias instaladas; se comprobó compilando y ejecutando la aplicación. Referencia: https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v6.

También existe Node 24.19.0 con npm 11.17.0 en el PATH del sistema. No se eliminó. Utilizar `fut.cmd` evita seleccionar esa versión accidentalmente. `.nvmrc` documenta Node 22.23.2; el script busca su instalación WinGet y, si no existe, acepta un Node 22 ya activo en PATH.

## PostgreSQL y Prisma

- Compose: `compose.yaml`, proyecto aislado `fut-analytics`.
- Contenedor: `fut-postgres`, reinicio `unless-stopped`, healthcheck validado.
- Dirección: `127.0.0.1:5444`, puerto interno 5432. Se conservó el puerto de la configuración recuperada y estaba libre.
- Base: `fut_analytics_history`, esquema `public`.
- Volumen persistente: `fut-analytics_fut_postgres_data`.
- PostgreSQL estándar; sin PostGIS ni extensiones adicionales requeridas por las migraciones.
- Usuario y contraseña derivados de la configuración existente y guardados solamente en `.env` ignorado. No se incluyen credenciales aquí.
- Dos migraciones aplicadas con `prisma migrate deploy`: `20260825212341_add_football_history_models` y `20260907162303_live_ingestion_offtarget_attacks`.
- `prisma migrate status`: actualizado. Comparación de base real con `schema.prisma`: sin diferencias.
- No se ejecutaron `db push`, `migrate reset` ni operaciones de borrado.

No se encontraron backups ni seeds en el proyecto. Los volúmenes Docker anteriores se identificaron como pertenecientes al otro proyecto y se conservaron. Se creó una base nueva con las migraciones existentes. El demo es información en memoria, no un seed de PostgreSQL.

## Comprobaciones

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd ci --no-audit --no-fund` | OK; 409 paquetes reinstalados |
| `prisma generate` | OK |
| `prisma validate` | OK |
| `prisma migrate deploy` / `status` | OK; dos migraciones |
| Comparación base/esquema | OK; sin diferencias |
| Consulta Prisma `SELECT 1` y conteos | OK |
| `npm run build` mediante `fut.cmd build` | OK; compilación y validación TypeScript |
| `npm run start` mediante `fut.cmd start` | OK |
| `npm run dev` mediante `fut.cmd dev` | OK |
| Dashboard `/` y `/api/matches` | HTTP 200; 103 partidos reales en la prueba |
| `/api/debug/football` | AllSportsApi conectada; HTTP 200 del proveedor |
| Detalle real `/matches/allsports-1812865` y su API | HTTP 200 |
| Snapshot LIVE del partido real | HTTP 200; partido LIVE, minuto 78 observado |
| Detalle y snapshot `demo-fenerbahce-lyon` | HTTP 200 |
| `/analyze`, `/analysis`, `/live-goal-radar` | HTTP 200 |
| Configuración de alertas de partido | HTTP 200 |
| Configuración de notificaciones / búsqueda vacía | HTTP 200 |
| API con identificador inexistente | HTTP 404 esperado |
| Chrome headless: dashboard, detalle real y demo | Sin excepciones ni errores de consola JavaScript |
| N/D en detalle real y demo | Visible en navegador; no se alteró el tratamiento de datos ausentes |

El dashboard/listado está en `/`; no existen páginas independientes `/dashboard` o `/matches`. Las comprobaciones son smoke tests, no una auditoría exhaustiva de todas las estrategias y endpoints. No se activaron notificaciones ni se enviaron mensajes. No se validó entrega push porque faltan las variables VAPID.

## Datos observados

La base tenía cero filas después de migrarla. Las pruebas normales de AllSportsApi hicieron persistir datos reales mediante el código existente:

| Modelo / conteo | Filas al comprobar |
| --- | ---: |
| Match (modelo anterior) | 0 |
| Fixture | 1 |
| MatchSnapshot (modelo anterior) | 0 |
| LiveSnapshot | 2 |
| OddsQuote (modelo anterior) | 0 |
| OddsSnapshot | 721 |
| TeamMatchStats | 2 |
| Fixture con estado FINISHED | 0 |

Los 103 partidos del listado son resultados del proveedor, no 103 partidos guardados. Los conteos pueden crecer al consultar la aplicación. No se inventaron datos ni se implementó un dataset nuevo. No hay históricos finalizados locales: tendencias de largo plazo, análisis retrospectivo y validaciones que los requieren siguen limitados. Cero filas almacenadas no equivale a una estadística futbolística de cero; los valores ausentes siguen sujetos a la lógica N/D existente.

## Variables y configuración

- `DATABASE_URL=<configured>`; conexión probada.
- `ALLSPORTS_API_KEY=<configured>`; acceso probado.
- `API_FOOTBALL_KEY=<missing>`; proveedor alternativo opcional.
- `LIVE_REFRESH_SECONDS=<configured>`.
- `NEXT_PUBLIC_DEMO_MODE=<configured>`; no se encontró consumo en código. El listado demo se selecciona por ausencia de claves de proveedores.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`: configuradas para Compose en `.env`.
- `API_FOOTBALL_SEASON`, `NEXT_PUBLIC_LIVE_REFRESH_SECONDS`, `RADAR_MAX_DEEP_ANALYSIS`: opcionales, con comportamiento por defecto en código.
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`: no configuradas en `.env`; pendientes para notificaciones y sincronización programada.
- `NODE_ENV`: gestionada por Next.js.

Git confirma que `.env` está ignorado y no versionado. `.env.example` contiene una plantilla Docker sin contraseña real; al usarla en otra instalación hay que sustituir `CHANGE_ME` en `DATABASE_URL` y definir la misma contraseña en `POSTGRES_PASSWORD`. No sustituir el `.env` existente por la plantilla en esta computadora.

## Pendientes y riesgos

1. `npm audit` diagnosticó 15 dependencias afectadas: 14 de severidad alta y una crítica (Next.js). La entrada de Next.js contiene dos avisos críticos y propone parche a partir de 15.5.24. No se ejecutó `audit fix` ni se actualizaron versiones. Es necesario tratar estos avisos antes de publicar o exponer el servidor. Avisos: https://github.com/advisories/GHSA-p293-qw3h-jr36 y https://github.com/advisories/GHSA-2xp9-vwfh-vxw4.
2. El navegador solicita `/favicon.ico`, que devuelve 404. No bloquea compilación ni navegación; se dejó sin cambios por alcance.
3. Faltan históricos locales recuperados; los datos LIVE actuales no los reconstruyen automáticamente.
4. El cron de `vercel.json` no se programa por ejecutar `npm run dev` localmente.
5. Hay numerosos cambios preexistentes y migraciones sin versionar. No se hicieron commits ni se revirtieron esos cambios. Se verificó por hashes que `src/`, `prisma/`, `package.json` y `package-lock.json` quedaron intactos durante la recuperación.
6. Las claves presentes en `.env.example` para funciones opcionales son plantillas; no prueban una configuración funcional.

## Archivos de esta recuperación

- Nuevos: `compose.yaml`, `fut.cmd`, `.nvmrc`, este reporte.
- Actualizado: `.env.example`, solo conexión de ejemplo y variables Docker.
- Actualizado localmente: `.env`, agregadas variables Docker derivadas de la conexión existente; ignorado por Git.
- Regenerados: `node_modules`, Prisma Client y artefactos de Next.js.

El entorno local queda operativo para compilar y ejecutar. La implementación del dataset histórico OVER 0.5 1T permanece pendiente y no forma parte de esta recuperación.
