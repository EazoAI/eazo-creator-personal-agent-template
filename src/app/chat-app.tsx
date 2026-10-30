"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { normalizeLocale, type LocaleCode } from "@/i18n";
import { usePaneLayout, BROWSER_MIN } from "@/hooks/use-pane-layout";
import { useRailLayout } from "@/hooks/use-rail-layout";
import { useRunSession } from "@/hooks/use-run-session";
import type { MuseSession } from "@/shared/muse-events";
import { BrowserPane } from "./browser-pane";
import { ChatThread } from "./chat-thread";
import { Composer } from "./composer";
import { SessionRail } from "./session-rail";

export default function ChatApp({ sessionId }: { sessionId?: string }) {
  const { t, i18n } = useTranslation();
  const locale = (normalizeLocale(i18n.resolvedLanguage || i18n.language) ?? "en") as LocaleCode;
  const examples = t("welcome.examples", { returnObjects: true }) as string[];

  const [railOpen, setRailOpen] = useState(false);
  const rail = useRailLayout();
  const pane = usePaneLayout({
    onDragStart: () => rail.setRailAnim(false),
    onDragEnd: () => rail.setRailAnim(true),
  });
  const {
    authState,
    items,
    cards,
    running,
    stopping,
    resuming,
    cardBusy,
    sessions,
    sessionsLoading,
    shownSessionId,
    hasRun,
    reopening,
    reopenFailed,
    viewerKey,
    paneBrowsers,
    controlActive,
    waitingForUser,
    start,
    stopRun,
    newConversation: goNewConversation,
    selectSession: goSelectSession,
    runCardAction,
    runBrowserControl,
    reopenBrowser,
    reportBrowserActivity,
    releaseMain,
  } = useRunSession(sessionId);

  const closeRail = useCallback(() => setRailOpen(false), []);

  const newConversation = useCallback(() => {
    closeRail();
    goNewConversation();
  }, [closeRail, goNewConversation]);

  const selectSession = useCallback(
    (session: MuseSession) => {
      closeRail();
      goSelectSession(session);
    },
    [closeRail, goSelectSession],
  );

  return (
    <div
      className={`app${railOpen ? " app--rail-open" : ""}${rail.railCollapsed ? " app--rail-collapsed" : ""}${rail.railAnim ? " app--rail-anim" : ""}`}
      style={{
        ["--rail-w" as string]: `${rail.railWidth}px`,
        ...(pane.browserWidth !== null
          ? { ["--browser-col" as string]: `minmax(${BROWSER_MIN}px, ${pane.browserWidth}px)` }
          : {}),
      }}
    >
      <div className="atmosphere" aria-hidden="true" />

      {railOpen && (
        <button type="button" className="rail-backdrop" aria-label={t("rail.closeList")} onClick={closeRail} />
      )}

      <SessionRail
        authenticated={authState.authenticated}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        shownSessionId={shownSessionId}
        locale={locale}
        onNewConversation={newConversation}
        onSelectSession={selectSession}
        onClose={closeRail}
        onCollapse={rail.toggleRailCollapsed}
        onRailDrag={rail.startRailDrag}
        onResetRailWidth={rail.resetRailWidth}
      />

      <section className="shell" ref={pane.shellRef}>
        <div
          className="pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("pane.resize")}
          title={t("pane.resize")}
          onPointerDown={pane.startPaneDrag}
          onDoubleClick={pane.resetPaneWidth}
        />
        <header className="topbar">
          <div className="topbar__left">
            <button type="button" className="rail-open" aria-label={t("rail.openList")} onClick={() => setRailOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              className="rail-expand"
              aria-label={t("rail.openList")}
              title={t("rail.expandSidebar")}
              onClick={rail.toggleRailCollapsed}
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

        <ChatThread
          items={items}
          cards={cards}
          resuming={resuming}
          running={running}
          cardBusy={cardBusy}
          examples={examples}
          onStart={start}
          onCardAction={(card, action) => void runCardAction(card, action)}
        />

        <Composer running={running} stopping={stopping} onStart={start} onStop={stopRun} />
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
