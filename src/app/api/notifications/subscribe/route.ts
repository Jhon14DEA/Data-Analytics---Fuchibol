import { NextResponse } from "next/server";
import { savePushSubscription } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      return NextResponse.json({ error: "Suscripcion push invalida" }, { status: 400 });
    }

    await savePushSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }
    });
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    console.error("[Web Push] No se pudo guardar la suscripcion", error);
    return NextResponse.json({ error: "Las notificaciones requieren una base de datos configurada" }, { status: 503 });
  }
}