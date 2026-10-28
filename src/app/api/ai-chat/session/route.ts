import { handleChat } from '@/services/aiChat/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(r: Request) { return handleChat(r,'session'); }
export function POST(r: Request) { return handleChat(r,'session'); }
export function DELETE(r: Request) { return handleChat(r,'session'); }
