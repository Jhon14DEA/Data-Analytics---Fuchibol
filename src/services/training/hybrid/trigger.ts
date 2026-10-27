import { hybridEnabled } from "./activation";
import { runHybridBatch } from "./processor";

// Register work with Next's response lifecycle, never a timer or awaited radar dependency.
export function scheduleHybridBatch(afterResponse: (work: () => Promise<void>) => void, run = runHybridBatch) {
  if (!hybridEnabled()) return;
  try {
    afterResponse(async () => {
      try { await run({ authorized: true, projectedDailyRequests: 50 }); }
      catch { console.info(JSON.stringify({ event: "HYBRID_PROCESSOR_FAILED" })); }
    });
  } catch { console.info(JSON.stringify({ event: "HYBRID_PROCESSOR_SCHEDULE_FAILED" })); }
}
