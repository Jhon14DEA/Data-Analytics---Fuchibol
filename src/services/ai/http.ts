import { createHash, timingSafeEqual } from 'node:crypto';
import { compactContext, createAiReader } from './reader';
import { aiOpenApi } from './openapi';

export function authorized(request: Request, key = process.env.FUT_AI_API_KEY): boolean {
  if (!key?.trim()) return false;
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return false;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(match[1]), hash(key));
}
const response = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) } });
type Reader = ReturnType<typeof createAiReader>;
async function loadReader(): Promise<Reader> {
  const { prisma } = await import('@/lib/prisma');
  return createAiReader(prisma);
}

export function createAiHandler(load: () => Promise<Reader> = loadReader) {
  return async (request: Request, kind: 'live' | 'fixture' | 'analysis-context' | 'openapi', id?: string) => {
    // Authenticate BEFORE loading the DB or validating parameters (including the schema route).
    if (!authorized(request)) return response({ error: 'Unauthorized' }, 401);
    if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405);
    try {
      if (kind === 'openapi') return response(aiOpenApi);
      if (kind === 'live') {
        const params = new URL(request.url).searchParams;
        const limit = params.get('limit') ?? '20', cursor = params.get('cursor') ?? undefined;
        if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 || (cursor !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor))) return response({ error: 'Invalid query parameters' }, 400);
        return response(await (await load()).live(Number(limit), cursor));
      }
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return response({ error: 'Invalid fixtureId' }, 400);
      const fixture = await (await load()).fixture(id);
      if (!fixture) return response({ error: 'Fixture not found' }, 404);
      return response(kind === 'analysis-context' ? compactContext(fixture) : fixture);
    } catch {
      // Never return/log Prisma errors, connection URLs, provider payloads or credentials.
      return response({ error: 'Stored data temporarily unavailable' }, 503);
    }
  };
}
export const handleAi = createAiHandler();
