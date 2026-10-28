# Chat IA dentro de FUT

## Uso

Abrir `/ai-chat` desde el enlace **Chat IA** del menú. La página se adapta a móvil/escritorio.

1. Introducir la contraseña privada del chat (distinta de las API keys).
2. Elegir **Panorama LIVE** para comparar presión entre partidos disponibles, o seleccionar un fixture del listado.
3. Escribir una pregunta o usar una sugerencia: análisis, histórico, goles, córners, tarjetas, remates o mercados para revisión humana.
4. Cada respuesta muestra las rutas FUT utilizadas y la hora de consulta. `Actualizar` y `Cargar más partidos` son acciones manuales; no hay polling.
5. El historial se mantiene en memoria de la pestaña, separado por fixture y panorama. `Borrar conversación` elimina la conversación actual; cerrar sesión borra todas. Recargar la página pierde el historial. No se sincroniza entre dispositivos ni se guarda en PostgreSQL/localStorage.

Si no hay LIVE frescos, aparece el estado vacío. No se consulta a AllSports/API-Football para llenar el selector. Un fixture que salió de LIVE puede seguir seleccionado; la consulta muestra el estado persistido y su cobertura, sin inventar una actualización.

## Configuración

En el `.env` **del servidor**, configurar:

```dotenv
FUT_AI_API_KEY=CLAVE_PRIVADA_DE_LA_API_FUT_EXISTENTE
OPENAI_API_KEY=TU_CLAVE_DE_LA_API_OPENAI
OPENAI_CHAT_MODEL=gpt-4.1-mini
FUT_AI_CHAT_PASSWORD=CONTRASENA_ALEATORIA_DISTINTA_DE_AL_MENOS_16_CARACTERES
FUT_AI_CHAT_SECURE_COOKIE=false
```

Los valores en mayúsculas son marcadores: reemplazarlos. Generar una contraseña aleatoria, por ejemplo con `openssl rand -hex 24`. No introducir claves reales en el código, Git, NEXT_PUBLIC_* ni formularios del chat. El usuario solo introduce la contraseña del chat. Una suscripción al producto ChatGPT no sustituye configurar una clave y facturación disponibles en la API OpenAI.

Compose ya carga `.env` para app. Después de subir estos cambios:

```bash
git pull
docker compose up -d --build --wait
```

Abrir `http://IP_DEL_SERVIDOR/ai-chat` en el despliegue HTTP existente; en local, `http://127.0.0.1:3000/ai-chat`. Para cambiar solo claves/modelo/contraseña, editar `.env` y ejecutar `docker compose up -d --no-deps --force-recreate app`.

La variable `PORT` es el puerto interno de Next.js (3000 por defecto). No confundir con `APP_PORT=80`, que es el puerto publicado por Docker. Las consultas internas van a `http://127.0.0.1:${PORT}/api/ai/...`, nunca a una URL proporcionada por el navegador ni derivada de Host.

En HTTP, contraseña, cookie y conversación viajan sin cifrar entre navegador y servidor. Se conserva compatibilidad con el despliegue actual; al habilitar HTTPS, poner `FUT_AI_CHAT_SECURE_COOKIE=true`. La conexión servidor–OpenAI usa HTTPS. No se modificó la infraestructura AWS.

## Flujo y límites

```text
Navegador /ai-chat
  → /api/ai-chat/session (contraseña → cookie HttpOnly)
  → /api/ai-chat/live (selector)
      → GET /api/ai/live con Bearer solo del servidor
  → POST /api/ai-chat/message (pregunta + historial limitado + fixtureId)
      → GET /api/ai/fixture/{fixtureId} para contexto detallado actual
        o GET /api/ai/live para panorama
      → POST https://api.openai.com/v1/responses
      ← texto + fuentes + hora + indicador de respuesta incompleta
```

El servicio del chat no importa Prisma, proveedores, ingestión, reglas de apuestas ni lectores directos de BD. Su única fuente de datos deportivos son `/api/ai/*`. Usa el detalle para disponer en una sola respuesta de estadísticas, histórico 5/10/20, presión, explosión, cobertura, eventos y alineaciones reales disponibles. No acepta snapshots ni URLs enviados por el cliente como fuente autorizada.

Panorama obtiene hasta cuatro páginas de 50 registros y avisa si hay continuación. No hace consultas de detalle de todos los partidos: para históricos, eventos, tarjetas o remates detallados hay que seleccionar uno. Cada mensaje vuelve a consultar FUT, sin reutilizar un contexto LIVE viejo del historial.

Responses API se llama sin herramientas externas, sin web search y con `store:false`; se extrae el texto de los items `message/output_text` (o una negativa del modelo). El modelo por defecto es configurable, no se garantiza acceso en todas las cuentas. Las conversaciones y el contexto necesario se envían a OpenAI para responder; `store:false` no se presenta como una garantía de retención cero de todo el servicio.

Límites propios del chat: 20 KB por solicitud, 12 mensajes máximos aceptados, 4000 caracteres por mensaje, contexto serializado máximo de 120000 caracteres y 1400 tokens de salida. La UI envía los últimos ocho mensajes, acotados a 1800 caracteres cada uno, y guarda hasta 40 turnos por conversación en memoria. Solicitudes internas: timeout de 15 segundos; OpenAI: 60 segundos. No hay reintentos automáticos que dupliquen llamadas facturadas.

Protección por proceso: máximo 30 intentos de login/minuto, 20 mensajes/minuto y dos consultas simultáneas. Estos límites son exclusivos del chat y no cambian los budgets de proveedores de FUT. No constituyen una cuota global distribuida entre réplicas ni un límite mensual de gasto; configurar controles de gasto en la cuenta OpenAI. No se añadieron dependencias npm ni SDKs.

## Seguridad y comportamiento

- Contraseña vacía o menor a 16 caracteres: acceso deshabilitado (503).
- Cookie firmada HMAC, HttpOnly, SameSite=Strict, ocho horas. Validación de origen en operaciones POST/DELETE. Rotar la contraseña invalida las sesiones firmadas con la anterior. Logout elimina la cookie del navegador; no existe lista central de revocación de cookies ya copiadas.
- Datos y llamadas de pago solo tras sesión válida. Ninguna API key se devuelve al navegador. Los errores externos se traducen a mensajes genéricos, sin payloads secretos ni logs de preguntas. El texto de salida se filtra contra las claves configuradas.
- Respuestas sin caché compartida. Se renderiza texto React escapado, no HTML del modelo; no hay `dangerouslySetInnerHTML` ni ejecución de código.
- Las instrucciones del modelo establecen: NULL/ausente = N/D, cero solo si observado, 1T separado de FT, muestras históricas separadas de ventanas LIVE, frescura y calidad explícitas. Historial, nombres y eventos se consideran texto no confiable.
- Los mercados solo se comentan como familias para revisión humana basada en evidencia. No se generan órdenes de apuesta, stakes, cuotas o probabilidades inventadas ni señales ENTRY/ALERT. Se conservan las señales informativas de FUT sin recalcular thresholds.
- Un LLM puede equivocarse pese a las instrucciones. La UI muestra fuentes y pide revisar; las pruebas comprueban el contrato de envío y controles, no garantizan la factualidad de toda respuesta futura.

## Archivos y validación

- `src/app/ai-chat/page.tsx`, `src/components/AiChat.tsx`, enlace en `MainNav.tsx`.
- `src/app/api/ai-chat/{session,live,message}/route.ts`.
- `src/services/aiChat/server.ts`: sesión, proxy a FUT y Responses API.
- `.env.example`, `package.json`, `tests/ai-chat.test.cjs` y este reporte.
- `npm run test:ai-chat`: 19 pruebas correctas, sin llamadas pagadas. Auth, origen público detrás de Docker, expiración, límites, claves, proxy fijo, datos frescos por turno, NULL/cero, paginación, errores y salida con fuentes.
- `npm run test:ai`: 24 pruebas de la API privada previa, sin regresiones.
- TypeScript sin emisión: correcto. **Build Docker final correcto**, incluyendo Prisma generate, Next.js, tipos y lint. No se instalaron paquetes adicionales. Persisten los avisos previos de npm sobre dependencias de producción (7 vulnerabilidades, una crítica); no se actualizaron dentro de esta tarea.
- Integración HTTP con imagen final y contenedor temporal: `/ai-chat` 200; siete recursos JS 200 y sin secretos de prueba; listado anónimo 401; login con Host/Origin públicos 200; listado con cookie 200; mensaje sin OPENAI_API_KEY 503 controlado. Se leyó la base existente mediante `/api/ai/live`, sin migraciones ni escrituras; devolvió 0 LIVE frescos. El contenedor temporal fue eliminado.
- **43 tests correctos en total** (19 chat + 24 API privada). No se probó una respuesta real de OpenAI ni la disponibilidad del modelo/crédito en tu cuenta. Los tests del intercambio Responses usan mocks, y el smoke HTTP real omite deliberadamente la clave OpenAI. Tampoco se automatizaron clics o capturas de navegador: la comprobación de UI fue de HTML/recursos y build; la adaptación móvil está implementada con CSS responsive.

No se cambió BET_SCORE, ENTRY, ALERT, thresholds, budgets existentes, Prisma, migraciones ni endpoints `/api/ai/*`. No se desplegó en AWS desde esta sesión.

Documentación oficial consultada: [generación de texto / Responses](https://developers.openai.com/api/docs/guides/text?api-mode=responses) y [modelo GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
