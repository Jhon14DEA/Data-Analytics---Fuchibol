import { selectReviewNow } from "./radarReviewNow";
import { classifyHybridEligibility, radarCompetition, type HybridRadarMatch } from "./radarHybridReview";

export type ReviewNotificationPermission = NotificationPermission | "unsupported";
export type ReviewNotificationMessage = { title: string; body: string; tag: string; targetId: string };
export type ReviewNotificationPort = { permission: ReviewNotificationPermission; show: (message: ReviewNotificationMessage) => void };
export const reviewFixtureAnchor = (fixtureId: string) => `review-fixture-${encodeURIComponent(fixtureId)}`;

// At most once per fixture/market per mounted radar, even after an eligibility exit/re-entry.
// Permission denial does not mark a fixture as sent. Filters never change this memory.
export function notifyHybridEligible(matches: readonly HybridRadarMatch[], sent: Set<string>, port: ReviewNotificationPort) {
  if (port.permission !== "granted") return 0;
  const competitions = new Map(matches.map(match => [match.fixtureId, radarCompetition(match)]));
  let delivered = 0;
  for (const fixture of selectReviewNow(matches)) {
    for (const candidate of fixture.markets) {
      if (classifyHybridEligibility(candidate).state !== "HYBRID_ELIGIBLE") continue;
      const key = JSON.stringify([fixture.fixtureId, candidate.market]);
      if (sent.has(key)) continue;
      try {
        port.show({ title: "FUT Analytics — Revisar partido",
          body: `${competitions.get(fixture.fixtureId) ?? candidate.competition} · ${candidate.match} · ${candidate.minute}' · SOT ${fixture.combinedSot} · ${candidate.market}`,
          tag: `hybrid-review:${key}`, targetId: reviewFixtureAnchor(fixture.fixtureId) });
        sent.add(key);
        delivered++;
      } catch { /* Notification errors must not interrupt the radar or mark a failed delivery as sent. */ }
    }
  }
  return delivered;
}

export function reviewNotificationPermission(): ReviewNotificationPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

// Called only by the existing explicit permission button. Never re-prompt denied/granted users.
export async function requestReviewNotificationPermission(): Promise<ReviewNotificationPermission> {
  const permission = reviewNotificationPermission();
  if (permission !== "default") return permission;
  try { return await Notification.requestPermission(); }
  catch { return reviewNotificationPermission(); }
}

export function browserReviewNotificationPort(): ReviewNotificationPort {
  return { permission: reviewNotificationPermission(), show(message) {
    const notification = new Notification(message.title, { body: message.body, tag: message.tag });
    notification.onclick = () => {
      window.focus();
      // Stay on this mounted radar: no navigation/prefetch that could trigger provider requests.
      const target = document.getElementById(message.targetId) ?? document.getElementById("review-now-title");
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
      notification.close();
    };
  } };
}
