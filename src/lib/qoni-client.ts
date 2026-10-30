"use client";

import {
  Qoni,
  QoniEventTypes,
  type Interaction,
  type InteractionHandle,
  type RunEvent,
  type RunHandle,
  type AskUserAnswer,
  type FormValues,
} from "@qoniai/qoni";

import { mapRunEvent, toMuseBrowser, toMuseCard } from "@/shared/event-map";
import {
  isOpenCard,
  type MuseBrowserControlAction,
  type MuseCardAction,
  type MuseServerEvent,
} from "@/shared/muse-events";

/**
 * Browser-side driver that talks to WebAgent directly.
 *
 * Architecture (token-to-browser):
 * - The server only exchanges the grant and starts / resolves the run, then returns
 *   `{ grant, runId, sessionRef }` to the client.
 * - The event stream is consumed here via `run.events()` on a browser Qoni client that
 *   only knows `webAgentHost` + the token. There is no server relay or run store.
 * - HITL card actions are executed here through `InteractionHandle`s as well.
 *
 * Security trade-off: `grant.token` reaches the browser (user-scoped, expiring). The
 * app's Qoni keys and `EAZO_PRIVATE_KEY` stay on the server.
 */

/** Run credentials handed to the client (only the user's own WebAgent token and host). */
export interface ClientGrant {
  token: string;
  webAgentHost: string | null;
}

export interface StartRunResult {
  grant: ClientGrant;
  runId: string;
  sessionId: string | null;
  /** Resume / replay anchor; passed back on attach. */
  sessionRef: { sessionId: string } | null;
}

/** Build a key-less browser client that only knows `webAgentHost` (the token is passed per call). */
function clientFor(grant: ClientGrant): Qoni {
  return new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });
}

/**
 * The SDK has no public wrapper for the session-browser routes the Qoni Console uses
 * (`/browser/reconnect`, `/browser/activity`). Its internal `webAgentJson` transport resolves the
 * WebAgent base URL and the tenant path from the token, so reuse it rather than rebuilding that.
 */
type WebAgentTransport = {
  webAgentJson<T>(
    method: "POST",
    path: string,
    token: string,
    payload: { body?: unknown; requiredScopes?: string[]; signal?: AbortSignal },
  ): Promise<{ data: T }>;
};

function webAgentPost<T>(grant: ClientGrant, path: string, body: unknown, signal?: AbortSignal): Promise<{ data: T }> {
  const transport = clientFor(grant) as unknown as WebAgentTransport;
  if (typeof transport.webAgentJson !== "function") {
    return Promise.reject(new Error("this Qoni SDK version cannot reach the session browser"));
  }
  return transport.webAgentJson<T>("POST", path, grant.token, {
    body,
    requiredScopes: ["webagent.do_anything:manage"],
    signal,
  });
}

/**
 * Reopen the session's lead browser between turns: signed in, on the page it was last on.
 * The backend closes a browser nobody used for ~2 minutes (and the session's computer sleeps), so
 * after a reload the list is usually empty; this is the Console's "Reopen" (`restoreSessionBrowser`).
 * Fails with 409 while a run is active.
 */
export async function reopenSessionBrowser(
  grant: ClientGrant,
  sessionId: string,
  pageUrl?: string | null,
): Promise<string> {
  const { data } = await webAgentPost<{ live_url?: string }>(
    grant,
    `/do_anything/sessions/${encodeURIComponent(sessionId)}/browser/reconnect`,
    { page_url: pageUrl || null },
    AbortSignal.timeout(30_000),
  );
  if (!data?.live_url) throw new Error("the browser did not come back");
  return data.live_url;
}

/** Tell the backend the person is using the browser, so it is not closed for idling. */
export async function touchSessionBrowser(grant: ClientGrant, sessionId: string): Promise<void> {
  await webAgentPost(grant, `/do_anything/sessions/${encodeURIComponent(sessionId)}/browser/activity`, {});
}

/** `run.browser_live_url_changed` with an empty URL: the lead browser closed. The SDK drops these. */
function isLeadBrowserClosed(wire: { event?: string; data: unknown }): boolean {
  const data = wire.data as { type?: string; data?: { live_url?: unknown }; live_url?: unknown } | null;
  if (!data || typeof data !== "object") return false;
  const type = data.type ?? wire.event;
  if (type !== "run.browser_live_url_changed") return false;
  const payload = data.data && typeof data.data === "object" ? data.data : data;
  return !payload.live_url;
}

/** A wire frame stamped well before attach (or with no usable stamp). */
function isReplayedWire(wire: { data: unknown }, attachedAt: number): boolean {
  const data = wire.data as { occurred_at?: unknown; ts?: unknown } | null;
  const stamp = data?.occurred_at ?? data?.ts;
  const at = typeof stamp === "string" ? Date.parse(stamp) : typeof stamp === "number" ? stamp : NaN;
  return !Number.isFinite(at) || at < attachedAt - HISTORY_SKEW_MS;
}

/** A take_control round opened by `openLogin()`; it belongs to the site_login card. */
function isLoginControl(interaction: Interaction): boolean {
  return (
    interaction.type === "take_control" &&
    (interaction.payload as { reason?: string } | undefined)?.reason === "site_login"
  );
}

/** Max reconnect attempts after a clean close without a terminal event. */
const MAX_RESUMES = 3;

/**
 * Drives one run: attach → iterate `events()` → forward normalized events to the UI.
 */
export interface RunDriver {
  runId: string;
  /** Run one HITL card action in the browser. */
  act(action: MuseCardAction): Promise<void>;
  /** Act on a sub-agent browser (take / release / done / skip). */
  controlBrowser(browserId: string, action: MuseBrowserControlAction): Promise<void>;
  /** Abort the event stream. */
  stop(): void;
  /**
   * Cancel the run on the backend (idempotent). The stream normally delivers the
   * terminal `done`; if it does not arrive shortly, a `done` is synthesized.
   */
  cancel(): Promise<void>;
}

/** How long to wait for the stream's own terminal event after a cancel. */
const CANCEL_SETTLE_MS = 5000;

/** Events older than attach time by more than this are treated as replayed history (tolerates clock skew). */
const HISTORY_SKEW_MS = 30_000;

export function driveRunInBrowser(
  result: StartRunResult,
  onEvent: (ev: MuseServerEvent) => void,
): RunDriver {
  const app = clientFor(result.grant);
  const controller = new AbortController();
  /** Open interactions by id, used to resolve card actions. */
  const interactions = new Map<string, InteractionHandle>();
  let runRef: RunHandle | null = null;
  /** Set once a terminal `done` has been emitted; guarantees a single `done` per run. */
  let finished = false;
  let resolveRun!: (run: RunHandle | null) => void;
  const runReady = new Promise<RunHandle | null>((resolve) => {
    resolveRun = resolve;
  });

  onEvent({ kind: "ready", runId: result.runId });

  const handleInteraction = (run: RunHandle, interaction: Interaction) => {
    const handle = run.interactionHandle(interaction);
    if (isLoginControl(interaction)) {
      // The login control round is driven from the site_login card; just surface its URL.
      const liveUrl = (interaction.payload as { liveUrl?: string }).liveUrl;
      if (interaction.status === "active" && liveUrl) onEvent({ kind: "screen", liveUrl, control: true });
      return;
    }
    const card = toMuseCard(handle);
    if (isOpenCard(card)) interactions.set(card.id, handle);
    else interactions.delete(card.id);
    onEvent({ kind: "card", card });
  };

  /** Settle every interaction still open: the run is over, so none can be acted on. */
  const cancelOpenInteractions = () => {
    for (const handle of interactions.values()) {
      onEvent({ kind: "card", card: { ...toMuseCard(handle), status: "canceled", actions: [] } });
    }
    interactions.clear();
  };

  /** Emit the run's terminal event exactly once. */
  const finish = (done: Extract<MuseServerEvent, { kind: "done" }>) => {
    if (finished) return;
    finished = true;
    cancelOpenInteractions();
    onEvent(done);
  };

  void (async () => {
    try {
      // start / resume already created the run server-side; attach and follow its events here.
      const run: RunHandle = await app.doAnything.attach(result.runId, {
        token: result.grant.token,
        session: result.sessionRef ?? undefined,
      });
      runRef = run;
      resolveRun(run);

      // The session's browsers outlive a single run: a follow-up run (or a replay after a page
      // refresh) may never emit a fresh `browser_live_url_changed`, and replayed viewer URLs can be
      // stale or redacted. Ask for the current, freshly signed list instead.
      const attachedAt = Date.now();
      let listed = false;
      const sessionId = result.sessionRef?.sessionId ?? run.sessionRef?.sessionId ?? result.sessionId;
      if (sessionId) {
        void app.doAnything.browsers
          .list({ token: result.grant.token, sessionId, signal: controller.signal })
          .then((list) => {
            if (controller.signal.aborted) return;
            listed = true;
            const browsers = list.filter((b) => b?.url).map(toMuseBrowser);
            onEvent({ kind: "browsers", browsers, snapshot: true });
          })
          .catch(() => {
            /* Fall back to whatever the event stream carries. */
          });
      }
      /** Replayed history (well before attach) whose viewer URLs the fresh list supersedes. */
      const isStaleBrowserEvent = (event: RunEvent, mapped: MuseServerEvent) =>
        listed &&
        (mapped.kind === "browsers" || (mapped.kind === "screen" && !mapped.control)) &&
        Date.parse(event.at) < attachedAt - HISTORY_SKEW_MS;

      let lastEventId: string | undefined;
      let resumes = 0;
      for (;;) {
        let sawTerminal = false;
        let progressed = false;
        for await (const event of run.events({
          signal: controller.signal,
          lastEventId,
          onWireEvent: (wire) => {
            if (wire.id) {
              lastEventId = wire.id;
              progressed = true;
            }
            // Replayed history is superseded by the fresh list, same as the stale filter below.
            if (isLeadBrowserClosed(wire) && !(listed && isReplayedWire(wire, attachedAt))) {
              onEvent({ kind: "screen", liveUrl: "" });
            }
          },
        })) {
          if (event.type === QoniEventTypes.Interaction) {
            handleInteraction(run, event.data as Interaction);
            continue;
          }
          const mapped = mapRunEvent(event as RunEvent);
          if (!mapped) continue;
          if (isStaleBrowserEvent(event as RunEvent, mapped)) continue;
          if (mapped.kind === "done") {
            sawTerminal = true;
            finish(mapped);
            continue;
          }
          onEvent(mapped);
        }
        if (sawTerminal || finished || controller.signal.aborted) return;

        // The server closed the stream cleanly without `run.completed`. Like `RunHandle.wait()`,
        // check the run status: finished → synthesize `done`; otherwise resume from the last id,
        // but only while the stream keeps making progress (avoid a tight reconnect loop).
        const status = await run.status();
        if (controller.signal.aborted) return;
        const terminal = status.status;
        if (terminal === "succeeded" || terminal === "failed" || terminal === "canceled") {
          finish({
            kind: "done",
            status: terminal,
            output: typeof status.output === "string" ? status.output : undefined,
          });
          return;
        }
        if (!progressed || ++resumes > MAX_RESUMES) {
          throw new Error(`event stream ended while the run is still "${terminal}"`);
        }
      }
    } catch (err) {
      resolveRun(null);
      if (controller.signal.aborted || finished) return; // Explicit stop is not an error.
      onEvent({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  })();

  const cancel = async (): Promise<void> => {
    if (finished) return;
    const run = runRef ?? (await runReady);
    if (!run) throw new Error("run is not attached");
    const status = await run.cancel("user_stop");
    if (finished) return;
    // Give the stream a moment to deliver `run.completed` (with the final message), then settle.
    await new Promise((resolve) => window.setTimeout(resolve, CANCEL_SETTLE_MS));
    if (finished || controller.signal.aborted) return;
    const s = status.status;
    finish({ kind: "done", status: s === "succeeded" || s === "failed" ? s : "canceled" });
  };

  const act = async (action: MuseCardAction): Promise<void> => {
    const handle = interactions.get(action.interactionId);
    if (!handle) throw new Error("unknown interactionId");

    switch (action.action) {
      case "answer":
        await handle.answer(action.value as AskUserAnswer);
        break;
      case "confirm":
        await handle.confirm();
        break;
      case "reject":
        await handle.reject();
        break;
      case "submit":
        await handle.submit(action.value as FormValues);
        break;
      case "skip":
        await handle.skip();
        break;
      case "open_login": {
        const siteId = action.value ? String(action.value) : undefined;
        const login = await handle.openLogin(siteId ? { siteId } : undefined);
        // Push the login surface to the UI so the user signs in inside the iframe.
        if (login?.liveUrl) onEvent({ kind: "screen", liveUrl: login.liveUrl, control: true });
        return;
      }
      case "confirm_signed_in":
        await handle.confirmSignedIn();
        break;
      case "connect_control":
      case "refresh_control": {
        const control =
          action.action === "connect_control" ? await handle.connectControl() : await handle.refreshControl();
        const payload = handle.interaction.payload as { liveUrl?: string };
        const liveUrl = control?.liveUrl ?? payload?.liveUrl;
        if (liveUrl) onEvent({ kind: "screen", liveUrl, control: true, reload: true });
        return;
      }
      case "release_control":
        await handle.releaseControl();
        break;
      default:
        throw new Error(`unsupported action: ${action.action}`);
    }
    // Card status updates arrive on the stream as `run.interaction` frames with the same id.
  };

  const controlBrowser = async (browserId: string, action: MuseBrowserControlAction): Promise<void> => {
    const sessionId = result.sessionRef?.sessionId ?? runRef?.sessionRef?.sessionId ?? result.sessionId;
    if (!sessionId) throw new Error("no session for this run");
    await app.doAnything.browsers.control({
      token: result.grant.token,
      sessionId,
      browserId,
      action,
    });
  };

  return {
    runId: result.runId,
    act,
    controlBrowser,
    stop: () => controller.abort(),
    cancel,
  };
}
