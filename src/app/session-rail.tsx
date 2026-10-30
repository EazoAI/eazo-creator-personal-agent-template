"use client";

import { useTranslation } from "react-i18next";

import { formatWhen, sessionLabel } from "@/lib/chat-format";
import type { LocaleCode } from "@/i18n";
import type { MuseSession } from "@/shared/muse-events";
import { UserMenu } from "./user-menu";

export function SessionRail({
  authenticated,
  sessions,
  sessionsLoading,
  shownSessionId,
  locale,
  onNewConversation,
  onSelectSession,
  onClose,
  onCollapse,
  onRailDrag,
  onResetRailWidth,
}: {
  authenticated: boolean;
  sessions: MuseSession[];
  sessionsLoading: boolean;
  shownSessionId: string | null;
  locale: LocaleCode;
  onNewConversation: () => void;
  onSelectSession: (session: MuseSession) => void;
  onClose: () => void;
  onCollapse: () => void;
  onRailDrag: (e: React.PointerEvent) => void;
  onResetRailWidth: () => void;
}) {
  const { t } = useTranslation();

  return (
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
            onClick={onCollapse}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <button type="button" className="rail-close" aria-label={t("rail.closeList")} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        </div>
      </div>

      <button
        type="button"
        className={`sessions__new${shownSessionId === null ? " sessions__new--on" : ""}`}
        onClick={onNewConversation}
        title={t("rail.newChatTitle")}
        aria-label={t("rail.newChat")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.9.9-3.6 9.1-9.5z" />
        </svg>
        <span className="sessions__new-label">{t("rail.newChat")}</span>
      </button>

      <div className="sessions__list">
        {!authenticated ? (
          <div className="sessions__empty">{t("rail.emptySignedOut")}</div>
        ) : sessions.length === 0 ? (
          <div className="sessions__empty">{sessionsLoading ? t("rail.loading") : t("rail.emptySignedIn")}</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`session-item${s.id === shownSessionId ? " session-item--on" : ""}`}
              onClick={() => onSelectSession(s)}
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
        onPointerDown={onRailDrag}
        onDoubleClick={onResetRailWidth}
      />
    </aside>
  );
}
