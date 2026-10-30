"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { auth } from "@eazo/sdk";
import { useEazo } from "@eazo/sdk/react";

import { normalizeLocale, type LocaleCode } from "@/i18n";
import { request } from "@/lib/request";
import { BrowserPane } from "./browser-pane";
import { HitlCard } from "./hitl-card";
import { Markdown } from "./markdown";
import { UserMenu } from "./user-menu";
import {
  driveRunInBrowser,
  reopenSessionBrowser,
  touchSessionBrowser,
  type ClientGrant,
  type RunDriver,
  type StartRunResult,
} from "@/lib/qoni-client";
import {
  isOpenCard,
  type MuseBrowser,
  type MuseBrowserControlAction,
  type MuseCard,
  type MuseCardAction,
  type MuseServerEvent,
  type MuseSession,
  type MuseStep,
  type MuseStepUpdate,
} from "@/shared/muse-events";

interface ChatItem {
  id: string;
  role: "user" | "assistant" | "progress" | "step" | "thinking";
  text: string;
  /** role === "step": the tool call it renders. */
  step?: MuseStep;
  /** role === "step": seqs of the notes already folded in (replay-safe dedup). */
  noteSeqs?: number[];
}

const stepItemId = (stepId: string) => `step-${stepId}`;

/**
 * Merge a streamed chunk into the text shown so far. Providers differ: some send
 * token deltas, others the whole growing text on every event (same as the Qoni Console).
 */
function mergeStreamingText(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming || incoming === current || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

function applyStepUpdate(prev: ChatItem[], update: MuseStepUpdate): ChatItem[] {
  if (update.type === "lifecycle") {
    const { step } = update;
    const id = stepItemId(step.id);
    const idx = prev.findIndex((p) => p.id === id);
    if (idx < 0) return [...prev, { id, role: "step", text: step.label, step, noteSeqs: [] }];
    const existing = prev[idx];
    // A retry (`started X → failed X → started X`) restarts the same entry.
    const restarted = step.status === "running" && existing.step?.status !== "running";
    const copy = [...prev];
    copy[idx] = {
      ...existing,
      text: step.label || existing.text,
      step: {
        ...existing.step,
        ...step,
        label: step.label || existing.step?.label || "",
        notes: restarted ? [] : existing.step?.notes,
      },
      noteSeqs: restarted ? [] : existing.noteSeqs,
    };
    return copy;
  }
  const id = stepItemId(update.stepId);
  const idx = prev.findIndex((p) => p.id === id);
  if (idx < 0) return prev;
  const existing = prev[idx];
  if (existing.noteSeqs?.includes(update.seq)) return prev;
  const copy = [...prev];
  copy[idx] = {
    ...existing,
    step: existing.step ? { ...existing.step, notes: [...(existing.step.notes ?? []), update.note] } : existing.step,
    noteSeqs: [...(existing.noteSeqs ?? []), update.seq],
  };
  return copy;
}

const CONTROL_CARD_TYPES = new Set(["take_control", "site_login"]);

function todayLabel(t: TFunction) {
  const h = new Date().getHours();
  if (h < 11) return t("today.morning");
  if (h < 18) return t("today.day");
  return t("today.evening");
}

function sessionLabel(s: MuseSession, t: TFunction): string {
  const title = (s.title ?? "").trim();
  return title || t("session.untitled");
}

function formatWhen(iso: string, locale: LocaleCode, t: TFunction): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hoursAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("time.daysAgo", { n: day });
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

export default function ChatApp({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale = (normalizeLocale(i18n.resolvedLanguage || i18n.language) ?? "en") as LocaleCode;
  const examples = t("welcome.examples", { returnObjects: true }) as string[];
  const authState = useEazo((s) => s.auth);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [cards, setCards] = useState<MuseCard[]>([]);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  /** Control / login surface URL for the main browser, while the user holds it. */
  const [controlUrl, setControlUrl] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<MuseBrowser[]>([]);
  const [viewerKey, setViewerKey] = useState(0);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  /** Stop pressed before `/start` returned: cancel as soon as the driver exists. */
  const stopRequestedRef = useRef(false);
  /** Bumped whenever the shown conversation changes; late responses from an older view are ignored. */
  const viewGenRef = useRef(0);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [sessions, setSessions] = useState<MuseSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  // Which session is shown (null = new chat). URL-driven; start sets this before router.push.
  const [shownSessionId, setShownSessionId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const liveUrlRef = useRef<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<RunDriver | null>(null);
  /**
   * The shown session's latest grant. Outlives the driver: reopening the session's browser after
   * its run ended (or after a page reload) needs a token but no event stream.
   */
  const sessionGrantRef = useRef<{ sessionId: string; grant: ClientGrant } | null>(null);
  /** The shown session has had at least one run (so it owns a browser that can be reopened). */
  const [hasRun, setHasRun] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenFailed, setReopenFailed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refreshSessionsRef = useRef<() => void>(() => {});

  const RAIL_MIN = 180;
  const RAIL_MAX = 420;
  const RAIL_DEFAULT = 220;
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  const [railAnim, setRailAnim] = useState(true);
  const draggingRef = useRef(false);

  // Chat ↔ browser divider. null = default proportional split.
  const BROWSER_MIN = 380;
  const CHAT_MIN = 340;
  const [browserWidth, setBrowserWidth] = useState<number | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("muse.browserWidth"));
      if (w >= BROWSER_MIN) setBrowserWidth(w);
    } catch {
      /* ignore */
    }
  }, []);

  const startPaneDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const shellLeft = shellRef.current?.getBoundingClientRect().left ?? 0;
    let last: number | null = null;
    setRailAnim(false);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    // Iframes swallow pointer events mid-drag; disable them while dragging.
    document.body.classList.add("is-pane-dragging");

    const onMove = (ev: PointerEvent) => {
      const max = window.innerWidth - shellLeft - CHAT_MIN;
      const w = Math.round(Math.min(max, Math.max(BROWSER_MIN, window.innerWidth - ev.clientX)));
      last = w;
      setBrowserWidth(w);
    };
    const onUp = () => {
      setRailAnim(true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("is-pane-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (last !== null) {
        try {
          localStorage.setItem("muse.browserWidth", String(last));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const resetPaneWidth = useCallback(() => {
    setBrowserWidth(null);
    try {
      localStorage.removeItem("muse.browserWidth");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("muse.railWidth"));
      if (w >= RAIL_MIN && w <= RAIL_MAX) setRailWidth(w);
      setRailCollapsed(localStorage.getItem("muse.railCollapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("muse.railCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const startRailDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setRailAnim(false);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX));
      setRailWidth(w);
    };
    const onUp = () => {
      draggingRef.current = false;
      setRailAnim(true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setRailWidth((w) => {
        try {
          localStorage.setItem("muse.railWidth", String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [items, cards]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input]);

  const handleServerEvent = useCallback(
    (ev: MuseServerEvent) => {
    if (ev.kind !== "ready") setResuming(false);
    switch (ev.kind) {
      case "ready":
        break;
      case "message":
        setItems((prev) => {
          const idx = prev.findIndex((p) => p.id === ev.messageId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], text: ev.text };
            return copy;
          }
          if (ev.role === "human") {
            // The prompt we already echoed locally comes back on the stream: adopt its id, don't duplicate.
            const local = prev.findIndex((p) => p.role === "user" && p.id.startsWith("u-") && p.text.trim() === ev.text.trim());
            if (local >= 0) {
              const copy = [...prev];
              copy[local] = { ...copy[local], id: ev.messageId };
              return copy;
            }
            return [...prev, { id: ev.messageId, role: "user", text: ev.text }];
          }
          return [...prev, { id: ev.messageId, role: "assistant", text: ev.text }];
        });
        break;
      case "thinking":
        setItems((prev) => {
          const last = prev[prev.length - 1];
          // Reasoning merges into the open thinking bubble; any other item settles it.
          if (last && last.role === "thinking") {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: mergeStreamingText(last.text, ev.text) };
            return copy;
          }
          return [...prev, { id: `t-${Date.now()}-${Math.random()}`, role: "thinking", text: ev.text }];
        });
        break;
      case "step":
        setItems((prev) => applyStepUpdate(prev, ev.update));
        break;
      case "progress":
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "progress" && last.text === ev.text) return prev;
          return [...prev, { id: `p-${Date.now()}-${Math.random()}`, role: "progress", text: ev.text }];
        });
        break;
      case "status":
        setRunStatus(ev.status);
        break;
      case "browsers":
        setBrowsers(ev.browsers);
        if (ev.snapshot) {
          // A fresh list is authoritative for the main viewer, including "no browser open".
          const main = ev.browsers.find((b) => b.id === "main")?.url ?? null;
          if (main !== liveUrlRef.current) {
            liveUrlRef.current = main;
            setLiveUrl(main);
          }
        }
        break;
      case "screen":
        if (ev.control) {
          setControlUrl(ev.liveUrl);
          if (ev.reload) setViewerKey((k) => k + 1);
          break;
        }
        // Like the Console: only re-attach on a forced reload or when the same URL is re-sent.
        if (!ev.liveUrl) {
          // The lead browser closed (idle timeout); the pane offers to reopen it.
          liveUrlRef.current = null;
          setLiveUrl(null);
          setBrowsers((prev) => prev.filter((b) => b.id !== "main"));
          break;
        }
        if (liveUrlRef.current && (ev.reload || liveUrlRef.current === ev.liveUrl)) setViewerKey((k) => k + 1);
        liveUrlRef.current = ev.liveUrl;
        setLiveUrl(ev.liveUrl);
        break;
      case "card":
        setCards((prev) => {
          const idx = prev.findIndex((c) => c.id === ev.card.id);
          const next = idx >= 0 ? [...prev] : [...prev, ev.card];
          if (idx >= 0) next[idx] = ev.card;
          return next.filter(isOpenCard);
        });
        // A control round that is no longer active hands the viewer back to the agent's live URL.
        if (CONTROL_CARD_TYPES.has(ev.card.type) && !isOpenCard(ev.card)) setControlUrl(null);
        break;
      case "done":
        setItems((prev) => [
          ...prev,
          {
            id: `done-${Date.now()}`,
            role: "progress",
            text: t("task.done", {
              status: t(`task.status.${ev.status}`),
              reason:
                ev.terminalReason && ev.terminalReason !== "done"
                  ? t("task.doneReason", { reason: ev.terminalReason })
                  : "",
            }),
          },
        ]);
        setRunning(false);
        setRunStatus(null);
        setCards([]);
        setControlUrl(null);
        driverRef.current?.stop();
        refreshSessionsRef.current();
        break;
      case "error":
        setItems((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "progress", text: t("task.error", { message: ev.message }) },
        ]);
        setRunning(false);
        setRunStatus(null);
        driverRef.current?.stop();
        break;
      default:
        break;
    }
    },
    [t],
  );

  /** Cancel the active run on the backend; the stream then delivers `done` (canceled). */
  const cancelDriver = useCallback(
    async (driver: RunDriver) => {
      try {
        await driver.cancel();
      } catch (err) {
        setStopping(false);
        setItems((prev) => [
          ...prev,
          {
            id: `warn-${Date.now()}`,
            role: "progress",
            text: t("task.stopError", { message: err instanceof Error ? err.message : String(err) }),
          },
        ]);
      }
    },
    [t],
  );

  const startDriver = useCallback(
    (result: StartRunResult) => {
      runIdRef.current = result.runId;
      const sid = result.sessionRef?.sessionId ?? result.sessionId;
      if (sid) sessionGrantRef.current = { sessionId: sid, grant: result.grant };
      setHasRun(true);
      setReopenFailed(false);
      driverRef.current?.stop();
      // `let` (not `const`): the driver emits `ready` synchronously, before the assignment below.
      let driver: RunDriver | null = null;
      driver = driveRunInBrowser(result, (ev) => {
        // A driver replaced by a conversation switch may still flush a buffered event; drop it.
        if (driver && driverRef.current !== driver) return;
        if (ev.kind !== "ready") setResuming(false);
        handleServerEvent(ev);
      });
      driverRef.current = driver;
      if (stopRequestedRef.current) {
        stopRequestedRef.current = false;
        void cancelDriver(driver);
      }
    },
    [handleServerEvent, cancelDriver],
  );

  const stopRun = useCallback(() => {
    if (!running || stopping) return;
    setStopping(true);
    const driver = driverRef.current;
    // Before `/start` returns there is no driver yet: cancel right after it is created.
    if (!driver) {
      stopRequestedRef.current = true;
      return;
    }
    void cancelDriver(driver);
  }, [running, stopping, cancelDriver]);

  // Any end of the run (done / error / reset) clears the stop state.
  useEffect(() => {
    if (running) return;
    setStopping(false);
    stopRequestedRef.current = false;
  }, [running]);

  const refreshSessions = useCallback(async () => {
    if (!authState.authenticated) return;
    setSessionsLoading(true);
    try {
      const res = await request("/api/webagent/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: MuseSession[] };
      setSessions(data.sessions ?? []);
    } catch {
      /* ignore list errors */
    } finally {
      setSessionsLoading(false);
    }
  }, [authState.authenticated]);

  useEffect(() => {
    refreshSessionsRef.current = () => {
      void refreshSessions();
    };
  }, [refreshSessions]);

  useEffect(() => {
    if (authState.authenticated) void refreshSessions();
    else setSessions([]);
  }, [authState.authenticated, refreshSessions]);

  /** Clear everything bound to the previous run's browser / status. */
  /**
   * Clear everything bound to the previous run. `keepBrowser`: a follow-up run in the same
   * session reuses the session's browser, so keep showing it until the new run says otherwise.
   */
  const resetRunView = useCallback((opts?: { keepBrowser?: boolean }) => {
    setCards([]);
    setControlUrl(null);
    setRunStatus(null);
    setReopenFailed(false);
    if (opts?.keepBrowser) return;
    setLiveUrl(null);
    liveUrlRef.current = null;
    setBrowsers([]);
    setHasRun(false);
    sessionGrantRef.current = null;
  }, []);

  const resetToNew = useCallback(() => {
    viewGenRef.current += 1;
    driverRef.current?.stop();
    driverRef.current = null;
    stopRequestedRef.current = false;
    runIdRef.current = null;
    setShownSessionId(null);
    setItems([]);
    resetRunView();
    setResuming(false);
    setRunning(false);
  }, [resetRunView]);

  const resumeSession = useCallback(
    async (id: string) => {
      const gen = ++viewGenRef.current;
      driverRef.current?.stop();
      driverRef.current = null;
      stopRequestedRef.current = false;
      runIdRef.current = null;
      setShownSessionId(id);
      setItems([]);
      resetRunView();
      setRunning(true);
      setResuming(true);

      try {
        const res = await request("/api/webagent/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        });
        const data = await res.json();
        // The user switched to another conversation while this request was in flight.
        if (gen !== viewGenRef.current) return;
        if (res.status === 401) throw new Error(t("errors.loginRequired"));
        if (!res.ok) throw new Error(data?.error || t("errors.openSessionFailed"));

        if (data.empty || !data.runId) {
          setResuming(false);
          setRunning(false);
          return;
        }
        startDriver(data as StartRunResult);
      } catch (err) {
        if (gen !== viewGenRef.current) return;
        setItems((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "progress",
            text: t("task.openSessionError", {
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ]);
        setResuming(false);
        setRunning(false);
      }
    },
    [startDriver, resetRunView, t],
  );

  const newConversation = useCallback(() => {
    setRailOpen(false);
    // Already on "/" (e.g. a new chat whose /start is still in flight): the URL won't change,
    // so reset directly. Otherwise the URL effect resets the view.
    if (!sessionId) resetToNew();
    else router.push("/");
  }, [sessionId, resetToNew, router]);

  const selectSession = useCallback(
    (session: MuseSession) => {
      if (session.id === shownSessionId) return;
      setRailOpen(false);
      router.push(`/c/${session.id}`);
    },
    [shownSessionId, router],
  );

  // Sync the shown conversation with the URL, reacting only to actual URL changes.
  // `start()` sets `shownSessionId` before `router.push` takes effect; reacting to that
  // intermediate render (URL still "/") would reset the view and then resume the session.
  const lastUrlIdRef = useRef<string | null | undefined>(undefined);
  const shownSessionIdRef = useRef<string | null>(null);
  shownSessionIdRef.current = shownSessionId;

  useEffect(() => {
    if (!authState.authenticated) {
      lastUrlIdRef.current = undefined; // re-sync after the next sign-in
      return;
    }
    const urlId = sessionId ?? null;
    if (lastUrlIdRef.current === urlId) return;
    lastUrlIdRef.current = urlId;
    if (urlId === shownSessionIdRef.current) return; // already showing it (e.g. set by start())
    if (urlId) void resumeSession(urlId);
    else resetToNew();
  }, [sessionId, authState.authenticated, resumeSession, resetToNew]);

  const start = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || running) return;
      if (!authState.authenticated) {
        try {
          await auth.login();
        } catch {
          return;
        }
      }
      setItems((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: prompt }]);
      setInput("");
      // Drop the previous (finished) driver so a stop pressed now waits for this run's driver.
      driverRef.current?.stop();
      driverRef.current = null;
      stopRequestedRef.current = false;
      setRunning(true);
      // Continuing an existing session: its browser is still open, keep it on screen.
      resetRunView({ keepBrowser: Boolean(shownSessionId) });
      const gen = viewGenRef.current;

      try {
        const res = await request("/api/webagent/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            sessionId: shownSessionId ?? undefined,
          }),
        });
        const data = await res.json();
        // The user moved to another conversation meanwhile: the run keeps going server-side
        // and shows up in the session list; don't hijack the current view.
        if (gen !== viewGenRef.current) {
          if (res.ok) refreshSessionsRef.current();
          return;
        }
        if (res.status === 401) throw new Error(t("errors.loginRequired"));
        if (!res.ok) throw new Error(data?.error || t("errors.startFailed"));

        runIdRef.current = data.runId;
        if (data.sessionId && data.sessionId !== shownSessionId) {
          setShownSessionId(data.sessionId);
          router.push(`/c/${data.sessionId}`);
        }
        startDriver(data as StartRunResult);
        // Make the new / now-running session visible in the rail so the user can switch back to it.
        refreshSessionsRef.current();
      } catch (err) {
        if (gen !== viewGenRef.current) return;
        setItems((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "progress",
            text: t("task.error", { message: err instanceof Error ? err.message : String(err) }),
          },
        ]);
        setRunning(false);
      }
    },
    [running, authState.authenticated, startDriver, resetRunView, router, shownSessionId, t],
  );

  const runCardAction = useCallback(
    async (card: MuseCard, action: Omit<MuseCardAction, "runId" | "interactionId">) => {
      const driver = driverRef.current;
      if (!driver || !runIdRef.current) return;
      setCardBusy(true);
      try {
        await driver.act({ runId: runIdRef.current, interactionId: card.id, ...action });
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            id: `warn-${Date.now()}`,
            role: "progress",
            text: t("task.cardActionError", {
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ]);
      } finally {
        setCardBusy(false);
      }
    },
    [t],
  );

  const runBrowserControl = useCallback(
    async (browserId: string, action: MuseBrowserControlAction) => {
      const driver = driverRef.current;
      if (!driver) return;
      setCardBusy(true);
      try {
        await driver.controlBrowser(browserId, action);
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            id: `warn-${Date.now()}`,
            role: "progress",
            text: t("task.cardActionError", {
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ]);
      } finally {
        setCardBusy(false);
      }
    },
    [t],
  );

  /** The shown session's grant; re-issued through `/resume` when none is held (it does not start a stream). */
  const grantFor = useCallback(async (sid: string, fresh = false): Promise<ClientGrant> => {
    const held = sessionGrantRef.current;
    if (!fresh && held?.sessionId === sid) return held.grant;
    const res = await request("/api/webagent/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    const data = await res.json();
    if (!res.ok || !data?.grant) throw new Error(data?.error || t("errors.openSessionFailed"));
    sessionGrantRef.current = { sessionId: sid, grant: data.grant as ClientGrant };
    return data.grant as ClientGrant;
  }, [t]);

  /** Reopen the session's closed browser between turns (the Console's "Reopen"). */
  const reopenBrowser = useCallback(async () => {
    const sid = shownSessionId;
    if (!sid || reopening) return;
    const gen = viewGenRef.current;
    setReopening(true);
    setReopenFailed(false);
    try {
      let url: string;
      try {
        url = await reopenSessionBrowser(await grantFor(sid), sid);
      } catch {
        // The held token may have expired: retry once with a fresh grant.
        url = await reopenSessionBrowser(await grantFor(sid, true), sid);
      }
      if (gen !== viewGenRef.current) return;
      liveUrlRef.current = url;
      setLiveUrl(url);
      setViewerKey((k) => k + 1);
    } catch {
      if (gen === viewGenRef.current) setReopenFailed(true);
    } finally {
      if (gen === viewGenRef.current) setReopening(false);
    }
  }, [shownSessionId, reopening, grantFor]);

  /** The person is at the browser: keep it from being closed for idling. */
  const reportBrowserActivity = useCallback(() => {
    const held = sessionGrantRef.current;
    if (!held || held.sessionId !== shownSessionId) return;
    void touchSessionBrowser(held.grant, held.sessionId).catch(() => {});
  }, [shownSessionId]);

  /** The take-control round the user currently holds, if any. */
  const activeControlCard = cards.find((c) => c.type === "take_control" && c.status === "active") ?? null;
  const controlActive = Boolean(activeControlCard || controlUrl);

  /** Browsers for the pane: the main viewer shows the control surface while the user holds it. */
  const paneBrowsers = useMemo<MuseBrowser[]>(() => {
    const mainUrl = controlUrl ?? liveUrl ?? browsers.find((b) => b.id === "main")?.url ?? null;
    const subs = browsers.filter((b) => b.id !== "main");
    if (!mainUrl) return subs;
    const main: MuseBrowser = {
      id: "main",
      label: null,
      url: mainUrl,
      status: null,
      activity: null,
      need: null,
      userInControl: controlActive,
    };
    return [main, ...subs];
  }, [browsers, liveUrl, controlUrl, controlActive]);

  const releaseMain =
    activeControlCard && activeControlCard.actions.includes("release_control")
      ? () => void runCardAction(activeControlCard, { action: "release_control" })
      : undefined;

  const waitingForUser = runStatus === "waiting" || cards.some((c) => c.status === "pending");

  const lastAssistantId = [...items].reverse().find((it) => it.role === "assistant")?.id;

  return (
    <div
      className={`app${railOpen ? " app--rail-open" : ""}${railCollapsed ? " app--rail-collapsed" : ""}${railAnim ? " app--rail-anim" : ""}`}
      style={{
        ["--rail-w" as string]: `${railWidth}px`,
        ...(browserWidth !== null
          ? { ["--browser-col" as string]: `minmax(${BROWSER_MIN}px, ${browserWidth}px)` }
          : {}),
      }}
    >
      <div className="atmosphere" aria-hidden="true" />

      {railOpen && (
        <button
          type="button"
          className="rail-backdrop"
          aria-label={t("rail.closeList")}
          onClick={() => setRailOpen(false)}
        />
      )}

      <aside className="sessions">
        <div className="sessions__head">
          <div className="brand" style={{ fontSize: 14, letterSpacing: "0.16em" }}>
            {t("rail.title")}
          </div>
          <div className="sessions__head-actions">
            <button
              type="button"
              className="rail-collapse"
              aria-label={t("rail.collapseSidebar")}
              title={t("rail.collapseSidebar")}
              onClick={toggleRailCollapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="rail-close"
              aria-label={t("rail.closeList")}
              onClick={() => setRailOpen(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`sessions__new${shownSessionId === null ? " sessions__new--on" : ""}`}
          onClick={newConversation}
          title={t("rail.newChatTitle")}
          aria-label={t("rail.newChat")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
            <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.9.9-3.6 9.1-9.5z" />
          </svg>
          <span className="sessions__new-label">{t("rail.newChat")}</span>
        </button>

        <div className="sessions__list">
          {!authState.authenticated ? (
            <div className="sessions__empty">{t("rail.emptySignedOut")}</div>
          ) : sessions.length === 0 ? (
            <div className="sessions__empty">
              {sessionsLoading ? t("rail.loading") : t("rail.emptySignedIn")}
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`session-item${s.id === shownSessionId ? " session-item--on" : ""}`}
                onClick={() => selectSession(s)}
              >
                <div className="session-item__title">{sessionLabel(s, t)}</div>
                <div className="session-item__meta">
                  {s.status === "running" ? t("session.running") : ""}
                  {formatWhen(s.updatedAt, locale, t)}
                </div>
              </button>
            ))
          )}
        </div>

        <UserMenu />

        <div
          className="rail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("rail.resize")}
          onPointerDown={startRailDrag}
          onDoubleClick={() => {
            setRailWidth(RAIL_DEFAULT);
            try {
              localStorage.setItem("muse.railWidth", String(RAIL_DEFAULT));
            } catch {
              /* ignore */
            }
          }}
        />
      </aside>

      <section className="shell" ref={shellRef}>
        <div
          className="pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("pane.resize")}
          title={t("pane.resize")}
          onPointerDown={startPaneDrag}
          onDoubleClick={resetPaneWidth}
        />
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="rail-open"
              aria-label={t("rail.openList")}
              onClick={() => setRailOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              className="rail-expand"
              aria-label={t("rail.openList")}
              title={t("rail.expandSidebar")}
              onClick={toggleRailCollapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="brand">{t("brand")}</div>
          </div>
          <div className="presence">
            <i className={running ? undefined : "idle"} />
            {running ? (waitingForUser ? t("presence.waiting") : t("presence.working")) : t("presence.idle")}
          </div>
        </header>

        <div className="thread" ref={chatRef} aria-live="polite">
          {resuming ? (
            <div className="loading" role="status" aria-live="polite">
              <span className="loading__orb" aria-hidden="true" />
              <span className="loading__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="loading__text">{t("loading.session")}</span>
            </div>
          ) : items.length === 0 ? (
            <>
              <div className="date">{todayLabel(t)}</div>
              <article className="message agent">
                <div className="eyebrow">
                  <span className="orb" /> agent
                </div>
                <div className="reply">{t("welcome.reply")}</div>
              </article>
              <div className="suggestions">
                {examples.map((ex) => (
                  <button key={ex} type="button" disabled={running} onClick={() => start(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </>
          ) : (
            items.map((it) => {
              if (it.role === "user") {
                return (
                  <div key={it.id} className="message user">
                    {it.text}
                  </div>
                );
              }
              if (it.role === "progress") {
                return (
                  <div key={it.id} className="message progress">
                    {it.text}
                  </div>
                );
              }
              if (it.role === "step" && it.step) {
                return <StepItem key={it.id} step={it.step} />;
              }
              if (it.role === "thinking") {
                const live = running && it.id === items[items.length - 1]?.id;
                return (
                  <details key={it.id} className="message thinking" open={live || undefined}>
                    <summary>{live ? t("thinking.live") : t("thinking.done")}</summary>
                    <div className="thinking__text">{it.text}</div>
                  </details>
                );
              }
              const streaming = running && it.id === lastAssistantId;
              return (
                <article key={it.id} className="message agent">
                  <div className="eyebrow">
                    <span className="orb" /> agent
                  </div>
                  <div className={`reply${streaming ? " streaming" : ""}`}>
                    <Markdown>{it.text}</Markdown>
                  </div>
                </article>
              );
            })
          )}
          {!resuming && running && items[items.length - 1]?.role === "user" && (
            // Optimistic indicator: shown as soon as the prompt is sent, until the first run event arrives.
            <div className="loading" role="status" aria-live="polite">
              <span className="loading__orb" aria-hidden="true" />
              <span className="loading__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="loading__text">{t("loading.starting")}</span>
            </div>
          )}
        </div>

        {cards.length > 0 && (
          <div className="cards">
            {cards.map((c) => (
              <HitlCard key={c.id} card={c} busy={cardBusy} onAction={(a) => runCardAction(c, a)} />
            ))}
          </div>
        )}

        <div className="composer-wrap">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              start(input);
            }}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder={t("composer.placeholder")}
              aria-label={t("composer.sendTask")}
              disabled={running}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start(input);
                }
              }}
            />
            {running ? (
              <button
                className="send send--stop"
                type="button"
                disabled={stopping}
                onClick={stopRun}
                aria-label={stopping ? t("composer.stopping") : t("composer.stop")}
                title={stopping ? t("composer.stopping") : t("composer.stop")}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="send" type="submit" disabled={!input.trim()} aria-label={t("composer.send")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </button>
            )}
          </form>
        </div>
      </section>

      <BrowserPane
        browsers={paneBrowsers}
        viewerKey={viewerKey}
        controlActive={controlActive}
        onReleaseMain={releaseMain}
        onBrowserControl={(id, action) => void runBrowserControl(id, action)}
        busy={cardBusy}
        canReopen={hasRun && !running && Boolean(shownSessionId)}
        reopening={reopening}
        reopenFailed={reopenFailed}
        onReopen={() => void reopenBrowser()}
        onActivity={reportBrowserActivity}
      />
    </div>
  );
}

function StepItem({ step }: { step: MuseStep }) {
  const { t } = useTranslation();
  const notes = step.notes ?? [];
  const head = (
    <>
      <i className={`step__icon step__icon--${step.status}`} aria-hidden="true" />
      <span className="step__label">{step.label}</span>
      {step.status === "failed" ? <span className="step__meta">{t("step.failed")}</span> : null}
      {step.durationMs !== undefined && step.status !== "running" ? (
        <span className="step__meta">{(step.durationMs / 1000).toFixed(1)}s</span>
      ) : null}
    </>
  );
  if (notes.length === 0 && !step.error) {
    return <div className={`message step step--${step.status}`}>{head}</div>;
  }
  return (
    <details className={`message step step--${step.status}`}>
      <summary>{head}</summary>
      {step.error ? <div className="step__error">{step.error}</div> : null}
      {notes.length > 0 ? (
        <ul className="step__notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
