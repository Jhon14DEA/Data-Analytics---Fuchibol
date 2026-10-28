import { handleChat } from '@/services/aiChat/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
export function POST(r: Request) { return handleChat(r,'message'); }
