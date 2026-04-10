import { ConnectRouter } from "@connectrpc/connect";
import { StudyService } from "@codelens/proto-ts";
import { StudyStore } from "./study-store.js";

// ---------------------------------------------------------------------------
// Route registration for the user-study logging service
// ---------------------------------------------------------------------------

export function registerStudyRoutes(
  router: ConnectRouter,
  studyStore: StudyStore,
) {
  router.service(StudyService, {
    async logEvents(req) {
      const rows = req.events.map((e) => ({
        userId: e.userId,
        sessionId: e.sessionId,
        eventType: e.eventType,
        targetElementId: e.targetElementId,
        timestampMs: Number(e.timestampMs),
        durationMs: e.durationMs,
        metadataJson: e.metadataJson || null,
      }));

      const accepted = studyStore.insertBatch(rows);
      return { acceptedCount: accepted };
    },
  });
}
