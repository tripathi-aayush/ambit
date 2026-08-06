// Orion Phase 2 (live runtime): consumes GET /plans/{id}/stream. Hand-
// rolled SSE parsing over Node's built-in fetch (no `eventsource`
// dependency, same "no bloat" call as picocolors-not-chalk in Phase 1) --
// uses response.body.getReader() explicitly rather than `for await` on
// the stream directly, so this doesn't depend on exactly which Node
// version's async-iteration-over-ReadableStream support is in play.

import { loadConfig } from "./config";
import type { PlanStreamMessage } from "@orion/shared";

interface RawSSEEvent {
  event: string;
  data: string;
}

async function* parseSSE(response: Response): AsyncGenerator<RawSSEEvent> {
  if (!response.body) throw new Error("no response body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!rawEvent.trim() || rawEvent.startsWith(":")) continue; // blank or a heartbeat comment

        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join("\n") };
        }
      }
    }
  } finally {
    // cancel(), not just releaseLock() -- releaseLock() only gives up the
    // JS-level lock on the reader, it doesn't tell the underlying fetch
    // to stop. Without an explicit cancel, an abandoned stream (e.g.
    // `--no-watch`, which fires the request then stops reading while the
    // server is still happily replaying/heartbeating) leaves the HTTP
    // connection genuinely open, which keeps Node's event loop alive and
    // the process hanging long after our own code is done with it.
    await reader.cancel().catch(() => {});
  }
}

/** Streams one plan's live progress. Callers should open this BEFORE
 * firing the POST that creates/runs the plan (see repoContext-adjacent
 * commands) -- subscribing first is what avoids missing anything that
 * happens between the POST landing and the stream connecting. */
export async function* streamPlan(planId: string): AsyncGenerator<PlanStreamMessage> {
  const config = loadConfig();
  if (!config) throw new Error("Not logged in. Run `orion login` first.");

  const res = await fetch(`${config.apiUrl}/plans/${planId}/stream`, {
    headers: { "X-Orion-Key": config.apiKey },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }

  for await (const { data } of parseSSE(res)) {
    yield JSON.parse(data) as PlanStreamMessage;
  }
}
