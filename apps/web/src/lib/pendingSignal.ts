// The nav's pending-approvals badge only refetches on navigation, which
// is fine for normal browsing but leaves it stale immediately after a
// decision is made without changing route (e.g. approving from Home and
// staying there). Callers that resolve a decision fire this; AppShell
// listens and refetches the count without needing a shared store.
const EVENT_NAME = "orion:pending-changed";

export function notifyPendingChanged() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function onPendingChanged(handler: () => void) {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
