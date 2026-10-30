"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { todayLabel } from "@/lib/chat-format";
import type { ChatItem } from "@/lib/chat-items";
import type { MuseCard, MuseCardAction } from "@/shared/muse-events";
import { HitlCard } from "./hitl-card";
import { Markdown } from "./markdown";
import { StepItem } from "./step-item";

export function ChatThread({
  items,
  cards,
  resuming,
  running,
  cardBusy,
  examples,
  onStart,
  onCardAction,
}: {
  items: ChatItem[];
  cards: MuseCard[];
  resuming: boolean;
  running: boolean;
  cardBusy: boolean;
  examples: string[];
  onStart: (prompt: string) => void;
  onCardAction: (card: MuseCard, action: Omit<MuseCardAction, "runId" | "interactionId">) => void;
}) {
  const { t } = useTranslation();
  const chatRef = useRef<HTMLDivElement>(null);
  const lastAssistantId = [...items].reverse().find((it) => it.role === "assistant")?.id;

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [items, cards]);

  return (
    <>
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
                <button key={ex} type="button" disabled={running} onClick={() => onStart(ex)}>
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
            <HitlCard key={c.id} card={c} busy={cardBusy} onAction={(a) => onCardAction(c, a)} />
          ))}
        </div>
      )}
    </>
  );
}
