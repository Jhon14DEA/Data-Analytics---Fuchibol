# FUT Analytics

Aplicación de análisis de fútbol con Next.js 15, React 19, TypeScript, Prisma y PostgreSQL 16.

## Estructura

| Parte | Ubicación | Servicio Docker |
|---|---|---|
| Frontend: páginas y componentes | `src/app/`, `src/components/` | `app` |
| Backend: endpoints HTTP | `src/app/api/` | `app` |
| Análisis, persistencia e integraciones | `src/services/`, `src/providers/`, `src/lib/` | `app` |
| Esquema y migraciones | `prisma/` | `migrate` aplica migraciones y termina |
| Base de datos | PostgreSQL 16 Alpine | `postgres` |

El navegador accede a Next.js en el puerto 3000. El backend se conecta a `postgres:5432` dentro de la red de Compose. Frontend y backend forman una sola aplicación. Los datos se guardan en el volumen `fut_postgres_data`.

## Levantar en otra computadora

Requisitos: Git y Docker con Compose v2. En Windows, iniciar Docker Desktop en modo contenedores Linux. No hace falta instalar Node ni PostgreSQL en el equipo para este modo. La primera construcción necesita Internet y puede tardar varios minutos; las siguientes reutilizan caché.

```powershell
git clone https://github.com/Jhon14DEA/Data-Analytics---Fuchibol.git
cd Data-Analytics---Fuchibol
Copy-Item .env.example .env
```

En Linux/macOS, usar `cp .env.example .env`. Los archivos de este despliegue deben estar previamente confirmados y subidos al repositorio.

Editar `.env` antes de arrancar:

```dotenv
POSTGRES_DB=fut_analytics_history
POSTGRES_USER=fut
POSTGRES_PASSWORD=REEMPLAZAR_POR_UNA_CLAVE_LARGA_ALEATORIA
POSTGRES_PORT=5444
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=3000
NEXT_PUBLIC_DEMO_MODE=true
```

Usar una contraseña larga con letras, números, guiones o guion bajo: Compose la inserta en una URL de conexión. Caracteres como `@`, `:`, `/`, `#`, `%` o `$` necesitan otro tratamiento de URL/interpolación y no deben usarse con esta plantilla.

Configurar `ALLSPORTS_API_KEY` / `API_FOOTBALL_KEY` si se desean datos del proveedor, y las variables VAPID si se usan notificaciones. No subir `.env` a Git. `NEXT_PUBLIC_*` es información pública y se fija durante la construcción; reconstruir la imagen si cambia `NEXT_PUBLIC_DEMO_MODE`. No activar procesos híbridos ni importaciones históricas solo para desplegar.

```powershell
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps -a
```

Abrir **http://localhost:3000**. Compose espera a que PostgreSQL esté saludable, ejecuta `prisma migrate deploy` y después inicia Next.js. `migrate` terminado con código 0 es normal. Si falla, la aplicación no arranca: revisar sus logs, sin borrar volúmenes ni resetear la base.

La `DATABASE_URL` usada dentro de los contenedores se construye con `POSTGRES_*` y apunta a `postgres:5432`; reemplaza el valor del `.env` solo dentro del contenedor. La URL `localhost:5444` del ejemplo sirve para ejecutar herramientas desde el equipo anfitrión y debe tener la misma contraseña. `localhost` dentro de `app` no apunta a PostgreSQL.

Para acceder desde otra computadora de la misma red, poner `APP_BIND_ADDRESS=0.0.0.0`, recrear con `docker compose up -d` y abrir `http://IP_DEL_EQUIPO:3000`. Permitir ese puerto en el firewall solo para la red deseada. Para publicar en Internet, preparar antes HTTPS y controles de acceso: este Compose proporciona un despliegue local/LAN, no configura un proxy ni autenticación adicional.

## Operación

```powershell
# Estado y logs
docker compose ps -a
docker compose logs --tail=100 app migrate postgres

# Actualizar código e imagen (respaldar los datos antes de migraciones nuevas)
git pull
docker compose up -d --build --wait

# Detener conservando datos
docker compose down

# Iniciar otra vez
docker compose up -d --wait
```

No usar `docker compose down -v` si se quieren conservar los datos: elimina el volumen. Cambiar POSTGRES_USER/PASSWORD/DB en `.env` después de inicializar un volumen no cambia automáticamente las credenciales de esa base.

El chequeo de salud de `app` comprueba que Next.js responde mediante su página de no encontrado, sin consultar proveedores. No certifica disponibilidad de APIs externas. Las migraciones se ejecutan como un servicio separado; no se ejecuta `prisma db push` ni `migrate reset`.

## Datos existentes y traslado

Clonar el repositorio y levantar Docker crea una base vacía con su esquema. **No transfiere los datos de la computadora original.** Para llevar históricos y snapshots, crear un respaldo y restaurarlo en el equipo nuevo. Estos comandos evitan redirigir un dump binario a través de PowerShell:

```powershell
# Equipo original: respaldo consistente dentro del contenedor
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/fut-backup.dump'
docker compose cp postgres:/tmp/fut-backup.dump ./fut-backup.dump
```

Transferir el dump de forma privada. En el equipo nuevo, configurar `.env` e iniciar **solo PostgreSQL** sobre un volumen nuevo, antes de arrancar app/migrate:

```powershell
docker compose up -d --wait postgres
docker compose cp ./fut-backup.dump postgres:/tmp/fut-backup.dump
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error /tmp/fut-backup.dump'
docker compose up -d --build --wait
```

Restaurar sobre una base vacía; estos comandos no sobrescriben deliberadamente una base existente. No confirmar dumps en Git. Una copia restaurada conserva el historial de migraciones y `migrate deploy` aplica las pendientes.

## Desarrollo sin contenedor de aplicación

Se conserva el flujo Windows con Node 22.23.2:

```powershell
.\fut.cmd build
.\fut.cmd start
```

`fut.cmd` inicia solo PostgreSQL en Docker y Next.js en Windows. No ejecutar simultáneamente esa aplicación local y `app` Docker en el mismo puerto; detener `app` con `docker compose stop app` o elegir otro `APP_PORT` para Docker.

La imagen sirve la aplicación web y contiene Prisma CLI para migraciones. No inicia workers históricos, cron ni procesos de importación adicionales. `.dockerignore` excluye credenciales locales, dependencias del anfitrión, builds, logs y dumps del contexto de construcción.

## Validación del despliegue

Se construyó la imagen y se levantó una copia aislada de Compose con base vacía y sin claves de proveedores: las nueve migraciones finalizaron correctamente, PostgreSQL y app quedaron saludables, y tanto `/` como `/api/analytics/training/over05-first-half?limit=1` respondieron HTTP 200. La aplicación ejecutó como usuario `node` (UID 1000) y no contenía `/app/.env`. La base habitual no se modificó durante esta prueba. No se probó una restauración de datos reales ni el acceso desde otra máquina física.

La instalación de dependencias de producción reportó **7 vulnerabilidades (6 altas y 1 crítica)** según npm audit durante la construcción. No se actualizaron dependencias ni se aplicó `audit fix --force` en esta tarea; revisar y corregir esos avisos antes de una publicación en Internet.
