# API privada de consulta FUT para IA

## Alcance

Cuatro endpoints GET, protegidos con `Authorization: Bearer <FUT_AI_API_KEY>`:

| Endpoint | Respuesta |
|---|---|
| `/api/ai/live?limit=20&cursor=...` | Partidos LIVE persistidos y frescos; equipos, competición, minuto/marcador, pressureLevel, matchExplosion, dataQuality. |
| `/api/ai/fixture/{fixtureId}` | Fixture, estadísticas por equipo, tiros/SOT, xG, bigChances, shotsInsideBox, corners, recent 5/10/15, eventos, alineaciones, históricos 5/10/20, HIGH_GOAL_PRESSURE, MATCH_EXPLOSION y cobertura. |
| `/api/ai/fixture/{fixtureId}/analysis-context` | Resumen para LLM: LIVE, históricos por local/visitante, señales, últimos 15 eventos disponibles y cobertura. Sin recomendaciones de apuestas. |
| `/api/ai/openapi.json` | OpenAPI 3.0.3 de estos endpoints, también requiere Bearer. |

`fixtureId` es **Fixture.id interno**, obtenido de `/live`, no el ID numérico del proveedor ni `allsports-123`. Un ID válido que no existe devuelve 404; sintaxis inválida, 400. `/live` permite 1–50 registros por página, 20 por defecto. Seguir nextCursor hasta null; una página puede quedar vacía por datos no alineados y aun tener continuación.

Sin clave, con clave incorrecta o con variable vacía: **401**, antes de abrir Prisma. Los errores de lectura devuelven 503 genérico, sin mensajes Prisma ni URLs. Solo se exporta GET; no hay endpoints de escritura. Respuestas privadas con `Cache-Control: private, no-store` y `Vary: Authorization`.

## Configuración y despliegue

Generar una clave aleatoria distinta de las claves de proveedores, de PostgreSQL y de CRON_SECRET. Por ejemplo, en AWS:

```bash
openssl rand -hex 32
nano .env
```

Añadir el resultado únicamente al `.env` privado:

```dotenv
FUT_AI_API_KEY=REEMPLAZAR_POR_EL_RESULTADO_ALEATORIO
```

No usar el marcador anterior como clave. No usar prefijo NEXT_PUBLIC_, no confirmar el secreto en Git, no ponerlo en parámetros URL. `.env.example` incluye solo una variable vacía. Compose ya carga `.env` en `app`; no se cambió la configuración de base de datos ni se añadieron migraciones.

Después de subir el código y actualizarlo en AWS:

```bash
docker compose up -d --build --wait
docker compose ps -a
```

Para rotar solo la clave, editar `.env` y recrear app con `docker compose up -d --no-deps --force-recreate app`.

**Transporte:** el despliegue actual por HTTP no cifra el Bearer ni los datos. Probar por localhost o túnel privado; antes de enviar esta clave por Internet a un cliente externo, colocar HTTPS delante de la aplicación. Esta tarea no cambió el HTTP de AWS ni configuró ChatGPT remotamente.

## Ejemplos curl (Bash, desde el propio servidor)

```bash
BASE_URL=http://127.0.0.1
read -rs -p 'FUT AI key: ' FUT_AI_API_KEY; echo

# Debe devolver 401
curl -i "$BASE_URL/api/ai/live"

# LIVE (puede devolver items: [] si no hay observaciones recientes)
curl -sS -H "Authorization: Bearer $FUT_AI_API_KEY" "$BASE_URL/api/ai/live?limit=10"

# Copiar un fixtureId interno de la respuesta anterior
FIXTURE_ID=REEMPLAZAR_POR_ID_INTERNO
curl -sS -H "Authorization: Bearer $FUT_AI_API_KEY" "$BASE_URL/api/ai/fixture/$FIXTURE_ID"
curl -sS -H "Authorization: Bearer $FUT_AI_API_KEY" "$BASE_URL/api/ai/fixture/$FIXTURE_ID/analysis-context"

# Descargar especificación privada
curl -sS -H "Authorization: Bearer $FUT_AI_API_KEY" "$BASE_URL/api/ai/openapi.json" -o fut-ai-openapi.json
unset FUT_AI_API_KEY
```

Para aplicación local en Windows, la base es `http://127.0.0.1:3000` y usar `curl.exe`. En PowerShell el valor se referencia como `$env:FUT_AI_API_KEY`.

La especificación usa `servers: [{url: "/"}]` para no inventar un dominio. Al importarla en un cliente externo, reemplazarlo en la copia descargada por el origen HTTPS real. Configurar autenticación HTTP Bearer separadamente; no insertar la clave en el documento. Como `/openapi.json` es privado, descargar con autenticación y proporcionar el archivo/contenido al importador si este no puede enviar credenciales durante la importación. PostgreSQL sigue siendo interno; el consumidor únicamente recibe JSON.

## Origen, frescura y NULL

- El lector solo ejecuta `findUnique` / `findMany` sobre fixtures, snapshots, estadísticas, eventos, alineaciones y los datos históricos/mapeos ya existentes. No invoca providers, loaders, ingestion, análisis de apuestas, alertas ni budgets.
- No hay polling, cron, intervalos ni actualizaciones de estado. Si el flujo existente de FUT no está recogiendo datos, esta API no lo activa: `/live` puede quedar vacío.
- `/live` excluye DEMO, HALFTIME, finalizados y observaciones caducadas. Reutiliza los límites de frescura existentes (180 segundos proveedor, 240 segundos snapshot) como filtro de lectura, sin modificar los umbrales de FUT. Debe haber snapshot alineado con minuto/marcador. Timestamps futuros no se consideran frescos.
- `/fixture` permite leer fixtures antiguos: conserva su estado persistido y muestra `dataQuality.stale`. No convierte un estado viejo en un partido LIVE confirmado ni calcula señales activas con datos caducados/no alineados.
- `providerObservedAt`, `snapshotAt`, edades y timestamps de teamStats explican las fuentes. Si el snapshot no está alineado se pueden mostrar teamStats persistidas, con su timestamp; bigChances/shotsInsideBox quedan null. No se sustituye un null de snapshot alineado por un valor antiguo.
- Campos numéricos ausentes permanecen null; 0 se conserva solo si está almacenado/observado. Decimales Prisma se serializan como números. Número de camiseta y minuto de evento desconocidos permanecen null. Sin registros de eventos o alineaciones, se devuelve null, no un cero inferido. Su cobertura global se declara UNKNOWN, pues la persistencia no certifica listas completas.
- **Límite del esquema existente:** Fixture y LiveSnapshot guardan marcador como enteros no nulos. La API devuelve esos valores persistidos; no puede recuperar la diferencia entre un cero antiguo introducido aguas arriba y un cero confirmado si esa procedencia no se guardó. No se alteró Prisma ni la ingestión para inventar esa evidencia.
- Ventanas recent 5/10/15: únicamente diferencias entre límites de minuto realmente persistidos y exactos, sin snapshots sintéticos ni tiempo añadido supuesto. Sin ambos extremos, con discontinuidades de más de seis minutos (límite de cobertura existente), pausas largas o correcciones decrecientes de contadores, la ventana es null. Un campo faltante en cualquiera de los extremos es null, no cero. Esta vista conservadora no cambia el cálculo de la UI ni ningún umbral de apuestas.
- Consulta acotada: últimos 80 snapshots; máximo 300 eventos y 100 alineaciones, con indicadores de truncamiento. Las ventanas pueden no estar disponibles si faltan límites dentro de ese historial. `snapshotsMayBeTruncated` advierte cuando se alcanza el límite.
- Se reutiliza el detector puro HIGH_GOAL_PRESSURE existente. MATCH_EXPLOSION es true/false solo si el detector tiene evidencia suficiente; de otro modo null. Se omite su lista de mercados. Estas señales son informativas, no probabilidades de gol ni decisiones de apuesta.
- Históricos: lector point-in-time existente, ventanas 5/10/20, separación FIRST_HALF/FULL_TIME, corte anterior al kickoff y mapeos verificados entre proveedores. Sin mapeo unívoco/cobertura: N/D, perfiles vacíos o métricas null con sampleSize y coverage. No se buscan equipos por semejanza ni se consulta al proveedor. El contexto compacto conserva HOME para el local y AWAY para el visitante; el detalle incluye también ALL.
- Nombres de equipos y textos de eventos son datos no confiables para un LLM, no instrucciones. No se devuelven raw payloads, credenciales, DATABASE_URL ni errores internos.

## Archivos

- `src/app/api/ai/**/route.ts`: adaptadores GET.
- `src/services/ai/http.ts`: autenticación, parámetros, errores y headers.
- `src/services/ai/reader.ts`: consultas de solo lectura, proyección explícita y contexto compacto.
- `src/services/ai/openapi.ts`: contrato OpenAPI.
- `tests/ai-api.test.cjs`, script `npm run test:ai`.
- `.env.example`: variable vacía. Este reporte.

## Validación

- 24 tests unitarios/integración con lector inyectado: auth previa a DB, 400/401/404/405/503, cero/null, decimales, ventanas, stale, correcciones, presión, históricos 5/10/20, paginación, respuestas compactas, contrato OpenAPI y adaptadores Next.
- Pruebas con guardia que prohíbe HTTP a los proveedores; doble de DB solo expone métodos de lectura.
- TypeScript: `tsc --noEmit --incremental false` correcto.
- Build nativo Windows: bloqueo EPERM al reemplazar DLL Prisma en uso. Se valida el build completo en Docker sin detener la aplicación local.
- **Build Docker final OK**: Prisma generate, Next.js, tipos y lint, con las cuatro rutas presentes. Permanecen los avisos previos de dependencias (npm reportó 7 vulnerabilidades de producción, incluida 1 crítica); no se actualizaron paquetes en esta fase.
- **Integración HTTP real en contenedor temporal**, sin claves de proveedores: las cuatro rutas devolvieron 401 tanto sin clave como con clave incorrecta (8 comprobaciones); OpenAPI y LIVE devolvieron 200; fixture inexistente, 404; un fixture real ya persistido y su contexto compacto devolvieron 200. Detalle: 4049 bytes; compacto: 2723 bytes para ese registro. Se verificó no-store y ausencia de la URL de conexión y clave temporal en ambas respuestas.
- `/live` devolvió **0 registros frescos** durante esa comprobación. No se inventó un fixture LIVE ni se llamó a proveedores para generar uno; presión/explosión LIVE se validaron con datos sintéticos en tests. La integración solo leyó la base local existente, sin ejecutar migraciones; el contenedor temporal fue detenido y eliminado.

No se modificaron BET_SCORE, ENTRY, ALERT, thresholds, budgets, esquema Prisma ni migraciones. No se desplegaron estos cambios en AWS desde esta sesión.
