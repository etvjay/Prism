// P7 observability — metrics hooks, correlation/operation IDs.
// Append-only pause decisions are durable in store.decisions; this hook exposes
// counters for dashboards without leaking payloads. No secrets, no raw calldata.

export type PauseMetricName =
  | "pause_created"
  | "pause_verified"
  | "pause_released"
  | "pause_cancelled"
  | "pause_escalated"
  | "pause_approved"
  | "pause_expired"
  | "pause_sweep"
  | "pause_verify_blocked_unknown"
  | "pause_release_blocked"
  | "settlement_operation_created"
  | "settlement_operation_submitted"
  | "approval_replay_blocked"
  | "plan_mutation_blocked"
  | "bypass_attempt_blocked";

export interface PauseMetrics {
  increment(name: PauseMetricName, tags?: Record<string, string>): void;
  gauge?(name: string, value: number, tags?: Record<string, string>): void;
}

export class NoopPauseMetrics implements PauseMetrics {
  increment(): void {}
}

export class InMemoryPauseMetrics implements PauseMetrics {
  readonly counts = new Map<string, number>();
  readonly events: Array<{ name: PauseMetricName; tags?: Record<string, string>; at: number }> = [];
  increment(name: PauseMetricName, tags?: Record<string, string>): void {
    const key = JSON.stringify({ name, tags: tags ? Object.keys(tags).sort().reduce((a, k) => ({ ...a, [k]: tags[k] }), {}) : undefined });
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.events.push({ name, tags, at: Date.now() });
  }
  count(name: PauseMetricName): number {
    let total = 0;
    for (const e of this.events) if (e.name === name) total++;
    return total;
  }
  all(): ReadonlyArray<{ name: PauseMetricName; tags?: Record<string, string> }> { return this.events; }
}

export interface CorrelationContext {
  correlationId: string | null;
  requestId: string | null;
  pauseId: string | null;
  operationId: string | null;
  planHash: string | null;
  approvalScopeHash: string | null;
}
