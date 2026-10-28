import { handleAi } from '@/services/ai/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  return handleAi(request, 'fixture', (await context.params).fixtureId);
}
