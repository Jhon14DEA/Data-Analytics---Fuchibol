import { handleAi } from '@/services/ai/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleAi(request, 'openapi'); }
