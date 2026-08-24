// Explicit Pause approval/release authority boundary.
// An app session is only an authenticated subject. It is never an authority
// decision. A caller must configure a resolver/policy that returns the
// authoritative actor before a consequential Pause mutation is allowed.

import type { ExecutionIntent } from "../domain/intent";
import type { ExecutionPlan } from "../domain/execution-plan";
import type { ExecutionPause } from "../domain/pause";

export type PauseAuthorityAction = "approve" | "release";
export type PauseAuthorityActor = "user" | "controller" | "authorized_agent" | "operator";

export interface PauseAuthorityRequest {
  readonly action: PauseAuthorityAction;
  /** Authenticated/requested subject only; the resolver must decide authority. */
  readonly subject: string | null;
  /** Optional untrusted claim from the request; never treated as authority by itself. */
  readonly claimedActor?: string | null;
  readonly pause: ExecutionPause;
  readonly intent: ExecutionIntent;
  readonly plan: ExecutionPlan;
}

export interface PauseAuthorityDecision {
  readonly authorized: boolean;
  /** The actor is supplied by the configured authority policy, never inferred from subject/session. */
  readonly actor?: PauseAuthorityActor;
}

export type PauseAuthorityResolver =
  | {
      resolve(input: PauseAuthorityRequest): Promise<PauseAuthorityDecision> | PauseAuthorityDecision;
    }
  | ((input: PauseAuthorityRequest) => Promise<PauseAuthorityDecision> | PauseAuthorityDecision);
