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
AI_PROVIDER=gemini
GEMINI_API_KEY=TU_CLAVE_DE_GEMINI
GEMINI_MODEL=ID_DEL_MODELO_DISPONIBLE_EN_TU_PROYECTO
# Opcional si se utiliza Gemini; requerido para AI_PROVIDER=openai:
OPENAI_API_KEY=TU_CLAVE_DE_LA_API_OPENAI
OPENAI_CHAT_MODEL=gpt-4.1-mini
FUT_AI_CHAT_PASSWORD=CONTRASENA_ALEATORIA_DISTINTA_DE_AL_MENOS_16_CARACTERES
FUT_AI_CHAT_SECURE_COOKIE=false
```

Los valores en mayúsculas son marcadores: reemplazarlos. `GEMINI_MODEL` debe ser el ID exacto de un modelo compatible con `generateContent` disponible para tu proyecto, sin URL ni prefijo `models/`; no se presume disponibilidad de un modelo concreto ni se selecciona uno automáticamente. Generar una contraseña aleatoria, por ejemplo con `openssl rand -hex 24`. No introducir claves reales en el código, Git, NEXT_PUBLIC_* ni formularios del chat. El usuario solo introduce la contraseña del chat.

`AI_PROVIDER=gemini` requiere solo GEMINI_API_KEY y GEMINI_MODEL para la IA. `AI_PROVIDER=openai` conserva OPENAI_API_KEY y OPENAI_CHAT_MODEL (por defecto gpt-4.1-mini). Si AI_PROVIDER no existe o está vacío, se conserva OpenAI para compatibilidad con despliegues previos. Un valor desconocido se rechaza explícitamente. `.env.example` propone Gemini para instalaciones nuevas; el `.env` real no se modificó. La facturación, cuota y acceso al modelo se configuran en el proveedor elegido.

Compose ya carga `.env` para app. Después de subir estos cambios:

```bash
git pull
docker compose up -d --build --wait
```

Abrir `http://IP_DEL_SERVIDOR/ai-chat` en el despliegue HTTP existente; en local, `http://127.0.0.1:3000/ai-chat`. Para cambiar solo claves/modelo/contraseña, editar `.env` y ejecutar `docker compose up -d --no-deps --force-recreate app`.

La variable `PORT` es el puerto interno de Next.js (3000 por defecto). No confundir con `APP_PORT=80`, que es el puerto publicado por Docker. Las consultas internas van a `http://127.0.0.1:${PORT}/api/ai/...`, nunca a una URL proporcionada por el navegador ni derivada de Host.

En HTTP, contraseña, cookie y conversación viajan sin cifrar entre navegador y servidor. Se conserva compatibilidad con el despliegue actual; al habilitar HTTPS, poner `FUT_AI_CHAT_SECURE_COOKIE=true`. La conexión servidor–proveedor IA usa HTTPS. No se modificó la infraestructura AWS.

## Flujo y límites

```text
Navegador /ai-chat
  → /api/ai-chat/session (contraseña → cookie HttpOnly)
  → /api/ai-chat/live (selector)
      → GET /api/ai/live con Bearer solo del servidor
  → POST /api/ai-chat/message (pregunta + historial limitado + fixtureId)
      → GET /api/ai/fixture/{fixtureId} para contexto detallado actual
        o GET /api/ai/live para panorama
      → Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent
        o OpenAI: POST https://api.openai.com/v1/responses
      ← texto + fuentes + hora + indicador de respuesta incompleta
```

El servicio del chat no importa Prisma, proveedores, ingestión, reglas de apuestas ni lectores directos de BD. Su única fuente de datos deportivos son `/api/ai/*`. Usa el detalle para disponer en una sola respuesta de estadísticas, histórico 5/10/20, presión, explosión, cobertura, eventos y alineaciones reales disponibles. No acepta snapshots ni URLs enviados por el cliente como fuente autorizada.

Panorama obtiene hasta cuatro páginas de 50 registros y avisa si hay continuación. No hace consultas de detalle de todos los partidos: para históricos, eventos, tarjetas o remates detallados hay que seleccionar uno. Cada mensaje vuelve a consultar FUT, sin reutilizar un contexto LIVE viejo del historial.

OpenAI Responses API conserva `store:false`, sin herramientas externas ni web search, y extrae `message/output_text` o negativa. Gemini usa `systemInstruction`, `contents` y `generationConfig.maxOutputTokens=1400`; traduce assistant a model y agrupa turnos consecutivos del mismo rol. GEMINI_API_KEY se envía exclusivamente en `x-goog-api-key`, nunca en la URL. Se extrae texto visible del primer candidato; los fragmentos marcados `thought` no se exponen. MAX_TOKENS/CONTINUATION se marcan como respuesta incompleta, sin continuación automática. Ambos reciben las mismas instrucciones de NULL=N/D, contexto persistido, 1T/FT y ausencia de apuestas automáticas.

La pregunta, historial y contexto FUT se envían únicamente al proveedor seleccionado. La UI utiliza una descripción neutral. No hay fallback silencioso a otro proveedor ni herramientas que permitan al modelo consultar fútbol o PostgreSQL. `store:false` de OpenAI no se presenta como garantía de retención cero y no se atribuye esa opción a Gemini; revisar las condiciones de datos de la cuenta del proveedor.

Errores Gemini: 402/429 → aviso de cuota/facturación (HTTP 429 del chat); 400/401/403/404 → revisar clave/modelo/permisos (502); 5xx → indisponibilidad temporal (503); timeout/red/JSON inválido → mensaje de conexión (503); contenido bloqueado → reformular (422); salida vacía → mensaje claro (502). No se muestran mensajes crudos del proveedor, claves ni URLs de error. Los errores no activan reintentos ni fallback.

Límites propios del chat: 20 KB por solicitud, 12 mensajes máximos aceptados, 4000 caracteres por mensaje, contexto serializado máximo de 120000 caracteres y 1400 tokens de salida configurados. La UI envía los últimos ocho mensajes, acotados a 1800 caracteres cada uno, y guarda hasta 40 turnos por conversación en memoria. Solicitudes internas: timeout de 15 segundos; proveedor IA: 60 segundos. No hay reintentos automáticos que dupliquen llamadas facturadas. Según el modelo, razonamiento interno puede consumir parte del límite y dejar una salida corta o vacía.

Protección por proceso: máximo 30 intentos de login/minuto, 20 mensajes/minuto y dos consultas simultáneas. Estos límites son exclusivos del chat y no cambian los budgets de proveedores de FUT. No constituyen una cuota global distribuida entre réplicas ni un límite mensual de gasto; configurar controles de gasto en el proveedor IA. No se añadieron dependencias npm ni SDKs.

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
- `src/services/aiChat/server.ts`: sesión, proxy a FUT, selección del proveedor y llamadas Gemini/OpenAI.
- `.env.example`, `package.json`, `tests/ai-chat.test.cjs` y este reporte.
- `npm run test:ai-chat`: 28 pruebas correctas, sin llamadas pagadas. Incluye las 19 anteriores y nueve nuevas de Gemini/selección: contrato/contexto, claves/modelo inválidos, proveedor desconocido, cuota sin fallback, errores sanitizados, red/timeout, contenido bloqueado/vacío, salida parcial y compatibilidad OpenAI explícita.
- `npm run test:ai`: 24 pruebas de la API privada previa, sin regresiones.
- TypeScript sin emisión: correcto. **Build Docker final correcto**, incluyendo Prisma generate, Next.js, tipos y lint. No se instalaron paquetes adicionales. Persisten los avisos previos de npm sobre dependencias de producción (7 vulnerabilidades, una crítica); no se actualizaron dentro de esta tarea.
- Integración HTTP con imagen final y contenedor temporal: `/ai-chat` 200; siete recursos JS 200 y sin secretos de prueba; listado anónimo 401; login con Host/Origin públicos 200; listado con cookie 200; mensaje sin OPENAI_API_KEY 503 controlado. Se leyó la base existente mediante `/api/ai/live`, sin migraciones ni escrituras; devolvió 0 LIVE frescos. El contenedor temporal fue eliminado.
- **52 tests correctos en total** (28 chat + 24 API privada). Los intercambios con Gemini/OpenAI usan mocks, no llamadas pagadas ni claves reales; no se certifican cuota, permisos ni disponibilidad de modelo en tu cuenta. La comprobación HTTP descrita arriba corresponde al cierre inicial del chat. No se automatizaron clics/capturas de navegador.

No se cambió BET_SCORE, ENTRY, ALERT, thresholds, budgets existentes, Prisma, migraciones ni endpoints `/api/ai/*`. No se desplegó en AWS desde esta sesión.

Documentación oficial consultada: [generación de texto / Responses](https://developers.openai.com/api/docs/guides/text?api-mode=responses) y [modelo GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

Gemini: [contrato generateContent](https://ai.google.dev/api/generate-content) y [errores y cuotas](https://ai.google.dev/gemini-api/docs/troubleshooting). Mantener `GEMINI_MODEL` actualizado de forma explícita según los modelos habilitados en tu proyecto.
