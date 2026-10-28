import { handleChat } from '@/services/aiChat/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(r: Request) { return handleChat(r,'live'); }
