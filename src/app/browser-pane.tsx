"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { MuseBrowser, MuseBrowserControlAction } from "@/shared/muse-events";

/** Viewers kept mounted at once; inactive ones are hidden, not unmounted, so switching back is instant. */
const VIEWER_DECK_SIZE = 4;

/** Browserbase viewers post this when their CDP connection drops. */
const DISCONNECT_MESSAGE = "browserbase-disconnected";

function isBrowserbaseOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "browserbase.com" || url.hostname.endsWith(".browserbase.com"));
  } catch {
    return false;
  }
}

function isDisconnectMessage(data: unknown): boolean {
  if (data === DISCONNECT_MESSAGE) return true;
  return Boolean(data && typeof data === "object" && (data as { type?: unknown }).type === DISCONNECT_MESSAGE);
}

interface Props {
  /** Browsers to show, lead (`main`) first. */
  browsers: MuseBrowser[];
  /** Bumped when the main viewer must re-attach (server-forced reload / new control URL). */
  viewerKey: number;
  /** The user holds the main browser (take-control round active or login surface open). */
  controlActive: boolean;
  /** Hand the main browser back to the agent; undefined when no release is currently legal. */
  onReleaseMain?: () => void;
  onBrowserControl: (browserId: string, action: MuseBrowserControlAction) => void;
  busy: boolean;
}

export function BrowserPane({ browsers, viewerKey, controlActive, onReleaseMain, onBrowserControl, busy }: Props) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>("main");
  const [deck, setDeck] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [disconnected, setDisconnected] = useState<Record<string, boolean>>({});
  const [reconnects, setReconnects] = useState<Record<string, number>>({});
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const seenNeeds = useRef(new Set<string>());

  const selected = browsers.find((b) => b.id === selectedId) ?? browsers[0] ?? null;
  const activeId = selected?.id ?? null;

  // Keep the active viewer in the deck (most recent last), evicting the oldest beyond the deck size.
  useEffect(() => {
    if (!activeId) return;
    setDeck((prev) => {
      const live = prev.filter((id) => id !== activeId && browsers.some((b) => b.id === id));
      return [...live, activeId].slice(-VIEWER_DECK_SIZE);
    });
  }, [activeId, browsers]);

  // Jump to a sub-agent browser the first time it asks the person for something.
  useEffect(() => {
    for (const b of browsers) {
      const key = b.need ? `${b.id}:${b.need.kind}:${b.need.prompt ?? ""}` : null;
      if (key && !seenNeeds.current.has(key)) {
        seenNeeds.current.add(key);
        setSelectedId(b.id);
      }
    }
  }, [browsers]);

  // Taking control of the main browser: focus it and expand the viewer.
  useEffect(() => {
    if (!controlActive) return;
    setSelectedId("main");
    setExpanded(true);
  }, [controlActive]);

  // A new main viewer attachment clears its disconnected cover.
  useEffect(() => {
    setDisconnected((d) => (d.main ? { ...d, main: false } : d));
  }, [viewerKey]);

  // Attribute Browserbase disconnect notices to the viewer that sent them.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!isBrowserbaseOrigin(ev.origin) || !isDisconnectMessage(ev.data)) return;
      for (const [id, frame] of frames.current) {
        if (frame.contentWindow && frame.contentWindow === ev.source) {
          setDisconnected((d) => ({ ...d, [id]: true }));
          return;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const reconnect = useCallback((id: string) => {
    setDisconnected((d) => ({ ...d, [id]: false }));
    setReconnects((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
  }, []);

  const inControl = selected ? (selected.id === "main" ? controlActive : selected.userInControl) : false;
  const hasLive = browsers.length > 0;

  return (
    <aside className={`browser${expanded ? " browser--expanded" : ""}`}>
      <header className="topbar">
        <div className="brand" style={{ fontSize: 14, letterSpacing: "0.16em" }}>
          browser
        </div>
        <div className="presence">
          <i className={hasLive ? undefined : "idle"} />
          {inControl ? t("browser.inControl") : hasLive ? t("browser.live") : t("browser.waiting")}
          {hasLive && (
            <button
              type="button"
              className="browser-expand"
              aria-label={expanded ? t("browser.collapse") : t("browser.expand")}
              title={expanded ? t("browser.collapse") : t("browser.expand")}
              onClick={() => setExpanded((e) => !e)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {expanded ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className={`browser-frame${inControl ? " browser-frame--control" : ""}`}>
        <div className="browser-chrome">
          <div className="browser-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {browsers.length > 1 ? (
            <div className="browser-tabs" role="tablist">
              {browsers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={b.id === activeId}
                  className={`browser-tab${b.id === activeId ? " browser-tab--on" : ""}`}
                  title={b.activity ?? undefined}
                  onClick={() => setSelectedId(b.id)}
                >
                  <i className={`browser-tab__dot browser-tab__dot--${b.status ?? "running"}`} aria-hidden="true" />
                  <span className="browser-tab__label">{b.id === "main" ? t("browser.mainTab") : b.label || t("browser.subagentTab")}</span>
                  {b.need ? <span className="browser-tab__badge">{t("browser.needBadge")}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="browser-label">{inControl ? t("browser.inControl") : "live session"}</div>
          )}
        </div>

        {selected && selected.id !== "main" && (selected.need || selected.userInControl) && (
          <div className="browser-need">
            <div className="browser-need__text">
              {selected.need?.prompt ||
                (selected.need?.kind === "login"
                  ? t("browser.needLogin", { site: selected.need.site ?? "" })
                  : selected.need
                    ? t("browser.needHelp")
                    : t("browser.inControl"))}
            </div>
            <div className="browser-need__actions">
              {!selected.userInControl ? (
                <button type="button" className="btn" disabled={busy} onClick={() => onBrowserControl(selected.id, "take")}>
                  {t("browser.take")}
                </button>
              ) : (
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onBrowserControl(selected.id, "release")}>
                  {t("browser.handBack")}
                </button>
              )}
              {selected.need && (
                <>
                  <button type="button" className="btn btn--ok" disabled={busy} onClick={() => onBrowserControl(selected.id, "done")}>
                    {t("browser.done")}
                  </button>
                  <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onBrowserControl(selected.id, "skip")}>
                    {t("hitl.skip")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {selected?.id === "main" && controlActive && onReleaseMain && (
          <div className="browser-need">
            <div className="browser-need__text">{t("browser.controlHint")}</div>
            <div className="browser-need__actions">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={onReleaseMain}>
                {t("browser.handBack")}
              </button>
            </div>
          </div>
        )}

        <div className={`screen${inControl ? " screen--control" : ""}`}>
          {hasLive ? (
            <div className="screen__deck">
              {deck.map((id) => {
                const b = browsers.find((x) => x.id === id);
                if (!b) return null;
                const on = id === activeId;
                const key = `${b.url}#${id === "main" ? viewerKey : 0}#${reconnects[id] ?? 0}`;
                return (
                  <iframe
                    key={key}
                    ref={(el) => {
                      if (el) frames.current.set(id, el);
                      else frames.current.delete(id);
                    }}
                    className={`screen__frame${on ? " screen__frame--on" : ""}`}
                    src={b.url}
                    title={`live browser ${b.id}`}
                    aria-hidden={!on}
                    tabIndex={on ? 0 : -1}
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                    allow="clipboard-read; clipboard-write"
                  />
                );
              })}
              {activeId && disconnected[activeId] && (
                <div className="screen__overlay">
                  <div>{t("browser.disconnected")}</div>
                  <button type="button" className="btn" onClick={() => reconnect(activeId)}>
                    {t("browser.reconnect")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="screen__empty">
              <span className="orb" aria-hidden="true" />
              <div>
                {t("browser.emptyLine1")}
                <br />
                {t("browser.emptyLine2")}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
