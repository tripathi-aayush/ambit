// Moved to packages/shared/events.ts (Orion Phase 2) so the web app and
// the CLI interpret event payloads through the same code, not two
// hand-kept-in-sync copies -- this file is now just the web app's entry
// point to it, kept so existing `@/lib/eventDetail` imports don't need
// to change at every call site.
export {
  describeEvent,
  riskReasons,
  policyReasons,
  executionOutcome,
  type ExecutionOutcome,
} from "@orion/shared";
