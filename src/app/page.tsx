"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "@eazo/sdk";
import { useEazo } from "@eazo/sdk/react";

import { HitlCard } from "./hitl-card";
import { request } from "@/lib/request";
import type { MuseCard, MuseCardAction, MuseServerEvent } from "@/shared/muse-events";

interface ChatItem {
  id: string;
  role: "user" | "assistant" | "progress";
  text: string;
}

const EXAMPLES = [
  "打开 https://en.wikipedia.org/wiki/Singapore ，用中文总结这个国家的关键信息。",
  "帮我查一下今天上海的天气，一句话告诉我要不要带伞。",
  "打开 Hacker News，告诉我现在排第一的帖子标题和大致讨论了什么。",
];

function todayLabel() {
  const h = new Date().getHours();
  if (h < 11) return "今早 · 说一句话开始";
  if (h < 18) return "今天 · 说一句话开始";
  return "今晚 · 说一句话开始";
}

export default function Home() {
  const authState = useEazo((s) => s.auth);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [cards, setCards] = useState<MuseCard[]>([]);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [items, cards]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input]);

  const handleServerEvent = useCallback((ev: MuseServerEvent) => {
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
          return [...prev, { id: ev.messageId, role: "assistant", text: ev.text }];
        });
        break;
      case "progress":
        setItems((prev) => [...prev, { id: `p-${Date.now()}-${Math.random()}`, role: "progress", text: ev.text }]);
        break;
      case "screen":
        setLiveUrl(ev.liveUrl);
        break;
      case "card":
        setCards((prev) => {
          const idx = prev.findIndex((c) => c.id === ev.card.id);
          const next = idx >= 0 ? [...prev] : [...prev, ev.card];
          if (idx >= 0) next[idx] = ev.card;
          return next.filter((c) => c.status === "pending");
        });
        break;
      case "done":
        setItems((prev) => [
          ...prev,
          {
            id: `done-${Date.now()}`,
            role: "progress",
            text: `任务结束：${ev.status}${ev.terminalReason ? ` (${ev.terminalReason})` : ""}`,
          },
        ]);
        setRunning(false);
        setCards([]);
        esRef.current?.close();
        break;
      case "error":
        setItems((prev) => [...prev, { id: `err-${Date.now()}`, role: "progress", text: `出错：${ev.message}` }]);
        setRunning(false);
        esRef.current?.close();
        break;
      default:
        break;
    }
  }, []);

  const start = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || running) return;
      if (!authState.authenticated) {
        try {
          await auth.login();
        } catch {
          return; // 用户取消登录
        }
      }
      setItems((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: prompt }]);
      setInput("");
      setRunning(true);
      setCards([]);
      setLiveUrl(null);

      try {
        const res = await request("/api/webagent/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (res.status === 401) throw new Error("请先登录");
        if (!res.ok) throw new Error(data?.error || "启动失败");

        runIdRef.current = data.runId;
        const es = new EventSource(`/api/webagent/stream?runId=${encodeURIComponent(data.runId)}`);
        esRef.current = es;
        es.onmessage = (e) => {
          const ev = JSON.parse(e.data) as MuseServerEvent | { kind: "_eof" };
          if ((ev as { kind: string }).kind === "_eof") {
            es.close();
            setRunning(false);
            return;
          }
          handleServerEvent(ev as MuseServerEvent);
        };
        es.onerror = () => {
          es.close();
          setRunning(false);
        };
      } catch (err) {
        setItems((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "progress", text: `出错：${err instanceof Error ? err.message : String(err)}` },
        ]);
        setRunning(false);
      }
    },
    [running, handleServerEvent, authState.authenticated],
  );

  const runCardAction = useCallback(
    async (card: MuseCard, action: Omit<MuseCardAction, "runId" | "interactionId">) => {
      if (!runIdRef.current) return;
      setCardBusy(true);
      try {
        const res = await request("/api/webagent/interaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: runIdRef.current, interactionId: card.id, ...action }),
        });
        const data = await res.json();
        if (!res.ok) {
          setItems((prev) => [
            ...prev,
            { id: `warn-${Date.now()}`, role: "progress", text: `卡片操作未生效：${data?.error ?? res.status}` },
          ]);
        }
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            id: `warn-${Date.now()}`,
            role: "progress",
            text: `卡片操作出错：${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        setCardBusy(false);
      }
    },
    [],
  );

  const lastAssistantId = [...items].reverse().find((it) => it.role === "assistant")?.id;

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      <section className="shell">
        <header className="topbar">
          <div className="brand">agent.</div>
          <div className="presence">
            {authState.loading ? (
              <span>…</span>
            ) : authState.authenticated ? (
              <button type="button" className="account" onClick={() => auth.logout()}>
                {authState.user?.name || authState.user?.email || "已登录"} · 退出
              </button>
            ) : (
              <button type="button" className="account" onClick={() => auth.login().catch(() => {})}>
                用 Eazo 账号登录
              </button>
            )}
            <i className={running ? undefined : "idle"} />
            {running ? "正在替你操作" : "云端浏览器待命"}
          </div>
        </header>

        <div className="thread" ref={chatRef} aria-live="polite">
          {items.length === 0 ? (
            <>
              <div className="date">{todayLabel()}</div>
              <article className="message agent">
                <div className="eyebrow">
                  <span className="orb" /> agent
                </div>
                <div className="reply">
                  给我一句话就好。需要查资料、比较航班，或在网页上完成操作——右侧会同步展示正在替你打开的浏览器。
                </div>
              </article>
              <div className="suggestions">
                {EXAMPLES.map((ex) => (
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
              const streaming = running && it.id === lastAssistantId;
              return (
                <article key={it.id} className="message agent">
                  <div className="eyebrow">
                    <span className="orb" /> agent
                  </div>
                  <div className={`reply${streaming ? " streaming" : ""}`}>{it.text}</div>
                </article>
              );
            })
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
              placeholder="此刻，你想让我做什么？"
              aria-label="发送任务"
              disabled={running}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start(input);
                }
              }}
            />
            <button className="send" type="submit" disabled={running || !input.trim()} aria-label="发送">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      </section>

      <aside className="browser">
        <header className="topbar">
          <div className="brand" style={{ fontSize: 14, letterSpacing: "0.16em" }}>
            browser
          </div>
          <div className="presence">
            <i className={liveUrl ? undefined : "idle"} />
            {liveUrl ? "实时画面" : "等待任务"}
          </div>
        </header>

        <div className="browser-frame">
          <div className="browser-chrome">
            <div className="browser-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="browser-label">live session</div>
          </div>
          <div className="screen">
            {liveUrl ? (
              <iframe
                className="screen__frame"
                src={liveUrl}
                title="live browser"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="screen__empty">
                <span className="orb" aria-hidden="true" />
                <div>
                  任务开始后，这里会显示正在操作的云端浏览器。
                  <br />
                  需要登录或验证码时，你可以直接在画面里操作。
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
