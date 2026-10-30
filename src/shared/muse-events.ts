/**
 * Event contract shared by the client and the server.
 *
 * The browser-side RunDriver normalizes Qoni RunEvents / InteractionHandles into
 * this compact set of events; the UI only understands these shapes and never
 * touches the Qoni wire format directly.
 */

export type MuseRole = "assistant";

/** Interaction lifecycle (backend-authoritative): pending → active → resolved | expired | canceled. */
export type MuseCardStatus = "pending" | "active" | "resolved" | "expired" | "canceled";

/** Compact projection of one HITL interaction, used for rendering. */
export interface MuseCard {
  /** Stable id for the whole lifecycle; the UI updates the same card by id. */
  id: string;
  type: "site_login" | "take_control" | "ask_user" | "confirmation" | "fill_form" | "wait";
  status: MuseCardStatus | string;
  title: string;
  prompt?: string | null;
  /** ISO 8601 deadline; past it the card can no longer be submitted. */
  expiresAt?: string | null;
  /** Actions the backend currently declares as legal (drives the buttons). */
  actions: string[];
  /** Type-specific projection, just enough to render. */
  payload?: {
    // ask_user
    question?: string;
    answerType?: "text" | "number" | "boolean" | "single_choice" | "multiple_choice";
    options?: { value: string; label: string }[];
    // confirmation
    summary?: string;
    // site_login
    sites?: { siteId: string; displayName: string; loginUrl: string }[];
    // take_control / live screen
    liveUrl?: string;
    // fill_form
    fields?: { name: string; label?: string; required?: boolean; type?: string }[];
  };
}

/** Whether a card still needs the user (pending, or active = user is working on it). */
export function isOpenCard(card: Pick<MuseCard, "status">): boolean {
  return card.status === "pending" || card.status === "active";
}

/**
 * Compact projection of one session (for the session list).
 *
 * Comes straight from Qoni's `doAnything.sessions.list`. The token is issued for
 * the signed-in user, so the list only ever contains that user's sessions.
 */
export interface MuseSession {
  id: string;
  title: string | null;
  status: "created" | "idle" | "running" | "stopped" | "timed_out" | "error" | string;
  /** Latest run of the session; resume / replay anchors on it. */
  latestRunId: string | null;
  updatedAt: string;
}

/** One agent tool call (`run.action.*`), keyed by `action_id` so retries fold into one entry. */
export interface MuseStep {
  id: string;
  /** Action kind, e.g. "click" / "navigate" / "input". */
  kind: string;
  label: string;
  status: "running" | "completed" | "failed";
  error?: string;
  durationMs?: number;
  /** `run.action.progress` notes, in seq order. */
  notes?: string[];
}

/** A step update: a full lifecycle event, or a single progress note for an existing step. */
export type MuseStepUpdate =
  | { type: "lifecycle"; step: MuseStep }
  | { type: "note"; stepId: string; seq: number; note: string };

/** A browser the run has open: the lead agent's (`id === "main"`) or a sub-agent's. */
export interface MuseBrowser {
  id: string;
  label: string | null;
  /** Interactive live viewer URL (iframe-able). Embeds credentials: never log it. */
  url: string;
  status: string | null;
  activity: string | null;
  need: { kind: "login" | "help"; site: string | null; prompt: string | null } | null;
  userInControl: boolean;
}

/** Terminal outcome of a run. */
export type MuseDoneStatus = "succeeded" | "failed" | "canceled" | "expired";

/** RunDriver → UI events. */
export type MuseServerEvent =
  | { kind: "ready"; runId: string }
  /** Streamed reply: update one bubble by messageId; `text` is the full reply so far. */
  | { kind: "message"; messageId: string; role: "ai" | "human"; text: string; done: boolean; final: boolean }
  /** Fallback progress line for wire events without a dedicated surface. */
  | { kind: "progress"; text: string }
  /** Agent tool step lifecycle / progress note. */
  | { kind: "step"; update: MuseStepUpdate }
  /** Model reasoning (planning-type messages). */
  | { kind: "thinking"; text: string }
  /** Run status change (`run.status_changed`). */
  | { kind: "status"; status: string; waitingReason?: string }
  /** The full list of browsers the run has open. */
  | { kind: "browsers"; browsers: MuseBrowser[] }
  /**
   * Live browser URL changed (shown in the iframe). Embeds credentials: never log it.
   * `reload` = the server asks the viewer to re-attach even if the URL is unchanged.
   * `control` = the URL is a take-control / login control surface.
   */
  | { kind: "screen"; liveUrl: string; reload?: boolean; control?: boolean }
  /** HITL card created / updated (any status). */
  | { kind: "card"; card: MuseCard }
  /** Run finished. */
  | { kind: "done"; status: MuseDoneStatus; output?: string; terminalReason?: string }
  /** Failure. */
  | { kind: "error"; message: string };

/** Actions on a sub-agent browser (`doAnything.browsers.control`). */
export type MuseBrowserControlAction = "take" | "release" | "done" | "skip";

/** UI → RunDriver: run one action on a HITL card. */
export interface MuseCardAction {
  runId: string;
  interactionId: string;
  action:
    | "open_login"
    | "confirm_signed_in"
    | "answer"
    | "confirm"
    | "reject"
    | "submit"
    | "connect_control"
    | "refresh_control"
    | "release_control"
    | "skip";
  /** Value for answer / form values for submit / siteId for open_login. */
  value?: unknown;
}
