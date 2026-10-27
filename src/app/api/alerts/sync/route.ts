import { NextResponse } from "next/server";
import { footballProvider } from "@/providers";
import { detectAlerts, LIVE_ACTIVITY_THRESHOLD } from "@/lib/alertEngine";
import { prisma } from "@/lib/prisma";
import { isPushConfigured, notifyNewLiveAlerts } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const matches = await footballProvider.listMatches();
  const results = [];

  for (const summary of matches.filter((match) => match.status === "LIVE").slice(0, 20)) {
    const match = await footballProvider.getMatch(summary.id);
    if (!match) continue;

    const previous = await footballProvider.getPreviousSnapshot(summary.id);
    const alerts = detectAlerts(match, previous).filter((alert) => alert.activityScore !== undefined);
    const createdAlerts = [];

    if (alerts.length > 0) {
      const databaseMatch = await prisma.match.upsert({
        where: { externalId: match.id },
        update: { homeTeam: match.homeTeam, awayTeam: match.awayTeam, competition: match.competition, status: match.status, minute: match.minute, homeScore: match.score.home, awayScore: match.score.away },
        create: { externalId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam, competition: match.competition, status: match.status, minute: match.minute, homeScore: match.score.home, awayScore: match.score.away }
      });

      for (const alert of alerts) {
        const fingerprint = alert.fingerprint ?? `${match.id}:${alert.type}:${alert.minute ?? "na"}:${alert.message}`;
        const created = await prisma.alert.create({
          data: { matchId: databaseMatch.id, fingerprint, type: mapAlertType(alert.type) as never, severity: alert.severity, title: alert.title, message: alert.message, minute: alert.minute }
        }).catch(() => null);
        if (created) createdAlerts.push(alert);
      }
    }

    if (createdAlerts.length > 0) {
      await notifyNewLiveAlerts(match, createdAlerts);
    }
    results.push({ matchId: match.id, alerts: createdAlerts.length, activityThreshold: LIVE_ACTIVITY_THRESHOLD });
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), pushConfigured: isPushConfigured(), results });
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function mapAlertType(type: string) {
  if (type === "SHOTS_ON_TARGET") return "SHOTS_SPIKE";
  if (type === "CORNERS" || type === "CARDS" || type === "RECOMMENDATION_CHANGE") return "DOMINANCE";
  return type;
}
