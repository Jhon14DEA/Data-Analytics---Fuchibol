import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import type { MatchAlert, MatchDetail } from "@/types/domain";

type PushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function configurePush() {
  if (!isPushConfigured()) {
    return false;
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return true;
}

export async function savePushSubscription(subscription: PushSubscription) {
  return prisma.notificationSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    create: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
  });
}

export async function notifyNewLiveAlerts(match: MatchDetail, alerts: MatchAlert[]) {
  if (!configurePush() || alerts.length === 0) {
    return { sent: 0, removed: 0 };
  }

  const subscriptions = await prisma.notificationSubscription.findMany();
  let sent = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({
          title: `${match.homeTeam} vs ${match.awayTeam}`,
          body: alerts.map((alert) => `${alert.title}: ${alert.message}`).join("\n"),
          url: `/matches/${match.id}`,
          activityScore: alerts[0].activityScore
        })
      );
      sent += 1;
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.notificationSubscription.delete({ where: { endpoint: subscription.endpoint } });
        removed += 1;
      } else {
        console.error("[Web Push] No se pudo enviar la alerta", error);
      }
    }
  }

  return { sent, removed };
}