import {
  QoniEventTypes,
  type AgentBrowser,
  type Interaction,
  type InteractionHandle,
  type RunEvent,
} from "@qoniai/qoni";

import type {
  MuseBrowser,
  MuseCard,
  MuseDoneStatus,
  MuseServerEvent,
  MuseStep,
} from "@/shared/muse-events";

/**
 * Normalizes Qoni RunEvents / InteractionHandles into the MuseServerEvents the UI consumes.
 *
 * This module is intentionally NOT server-only: the event stream is consumed in the
 * browser via `run.events()`, so the projection must run on the client too. It is a
 * pure data projection and never touches the token.
 */

/** Wire types that carry no user-facing signal (the Qoni Console does not render them either). */
const DROPPED_WIRE_PREFIXES = [
  "run.cost_update",
  "run.recording_",
  "run.browser_agent.",
  "run.browser_agent_tab",
  "run.agent.context_",
  "run.subtask_",
  "run.todos_updated",
  "run.input_request",
  "run.take_control_",
  "run.user_paused",
  "run.user_released",
  "run.feedback_submitted",
  "run.action_result",
  "run.screenshot",
  // Sub-agent lifecycle is surfaced through the `browsers` event instead.
  "run.subagent.",
  "stream.heartbeat",
];

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The original wire type and snake_case payload behind a semantic event. */
function wireOf(event: RunEvent): { type: string; payload: JsonObject } {
  const raw = asObject((event as { raw?: unknown }).raw);
  const envelope = asObject(raw.data);
  const type = asString(raw.event) ?? asString(envelope.type) ?? "";
  return { type, payload: asObject(envelope.data) };
}

function stepFromAction(type: string, p: JsonObject): MuseStep | null {
  const id = asString(p.action_id);
  if (!id) return null;
  const element = asObject(p.element_location);
  const kind = asString(p.kind) ?? "action";
  const label = asString(p.label) ?? asString(element.label) ?? kind;
  const status: MuseStep["status"] =
    type === "run.action.completed" ? "completed" : type === "run.action.failed" ? "failed" : "running";
  const step: MuseStep = { id, kind, label, status };
  if (typeof p.duration_ms === "number") step.durationMs = p.duration_ms;
  const error = asString(p.error);
  if (error) step.error = error;
  return step;
}

/** Map a raw wire type hidden behind a `progress` event to a dedicated event (or drop it). */
function mapProgress(event: RunEvent): MuseServerEvent | null {
  const { type, payload } = wireOf(event);

  if (type === "run.action.started" || type === "run.action.completed" || type === "run.action.failed") {
    const step = stepFromAction(type, payload);
    return step ? { kind: "step", update: { type: "lifecycle", step } } : null;
  }
  if (type === "run.action.progress") {
    const stepId = asString(payload.action_id);
    const note = asString(payload.note);
    if (!stepId || !note) return null;
    const seq = typeof payload.seq === "number" ? payload.seq : 0;
    return { kind: "step", update: { type: "note", stepId, seq, note } };
  }
  if (type === "run.status_changed") {
    const status = asString(payload.to);
    if (!status) return null;
    return { kind: "status", status, waitingReason: asString(payload.waiting_reason) };
  }
  if (DROPPED_WIRE_PREFIXES.some((prefix) => type.startsWith(prefix))) return null;

  const text = typeof event.data === "string" ? event.data : "";
  if (!text.trim()) return null;
  // The SDK folds planning / non-assistant `run.message`s (model reasoning) into progress.
  if (type === "run.message") return { kind: "thinking", text };
  return { kind: "progress", text };
}

function toMuseBrowser(b: AgentBrowser): MuseBrowser {
  return {
    id: b.id,
    label: b.label,
    url: b.url,
    status: b.status,
    activity: b.activity,
    need: b.need ? { kind: b.need.kind, site: b.need.site, prompt: b.need.prompt } : null,
    userInControl: b.userInControl,
  };
}

function doneStatus(terminalReason: string | undefined, succeeded: boolean | null | undefined): MuseDoneStatus {
  switch (terminalReason) {
    case "done":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "expired":
      return "expired";
    default:
      return succeeded === false ? "failed" : "succeeded";
  }
}

/** Map one Qoni RunEvent to a MuseServerEvent (unknown / noise events return null). */
export function mapRunEvent(event: RunEvent): MuseServerEvent | null {
  // RunEvent is a discriminated union; read `data` through a loose view to avoid narrowing to never.
  const ev = event as { type: string; data: unknown };
  switch (ev.type) {
    case QoniEventTypes.Message: {
      const data = ev.data as { id: string; role?: string; text: string; done?: boolean; final?: boolean };
      return {
        kind: "message",
        messageId: data.id,
        role: data.role === "human" ? "human" : "ai",
        text: data.text ?? "",
        done: Boolean(data.done),
        final: Boolean(data.final),
      };
    }
    case QoniEventTypes.Progress:
      return mapProgress(event);
    case QoniEventTypes.Browsers: {
      const browsers = Array.isArray(ev.data) ? (ev.data as AgentBrowser[]) : [];
      return { kind: "browsers", browsers: browsers.filter((b) => b?.url).map(toMuseBrowser) };
    }
    case QoniEventTypes.BrowserLiveUrlChanged: {
      const data = ev.data as { liveUrl: string; forceViewerReload?: boolean };
      if (!data?.liveUrl) return null;
      return { kind: "screen", liveUrl: data.liveUrl, reload: Boolean(data.forceViewerReload) };
    }
    case QoniEventTypes.Done: {
      const data = ev.data as { output?: unknown; succeeded?: boolean | null; terminalReason?: string };
      return {
        kind: "done",
        status: doneStatus(data.terminalReason || undefined, data.succeeded),
        output: typeof data.output === "string" ? data.output : undefined,
        terminalReason: data.terminalReason || undefined,
      };
    }
    default:
      return null;
  }
}

/** Project an InteractionHandle (and its underlying interaction) into a renderable MuseCard. */
export function toMuseCard(handle: InteractionHandle): MuseCard {
  const it = handle.interaction as Interaction;
  const card: MuseCard = {
    id: it.id,
    type: it.type,
    status: it.status,
    title: it.title,
    prompt: it.prompt ?? null,
    expiresAt: it.expiresAt ?? null,
    actions: (it.actions ?? []).map((a) => a.kind),
    payload: {},
  };

  switch (it.type) {
    case "ask_user": {
      const p = it.payload;
      card.payload = {
        question: p.question,
        answerType: p.answerType,
        options: p.options?.map((o) => ({ value: o.value, label: o.label })),
      };
      break;
    }
    case "confirmation": {
      card.payload = { summary: it.payload.summary };
      break;
    }
    case "site_login": {
      card.payload = {
        sites: it.payload.sites?.map((s) => ({
          siteId: s.siteId,
          displayName: s.displayName,
          loginUrl: s.loginUrl,
        })),
      };
      break;
    }
    case "take_control": {
      card.payload = { liveUrl: it.payload.liveUrl };
      break;
    }
    case "fill_form": {
      // FillFormPayload.fields may change shape across versions; project loosely.
      const fields = (it.payload as { fields?: unknown[] }).fields ?? [];
      card.payload = {
        fields: fields.map((f) => {
          const field = f as { name: string; label?: string; required?: boolean; type?: string };
          return {
            name: field.name,
            label: field.label,
            required: field.required,
            type: field.type,
          };
        }),
      };
      break;
    }
    default:
      break;
  }

  return card;
}
