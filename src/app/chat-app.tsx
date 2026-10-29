"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { auth } from "@eazo/sdk";
import { useEazo } from "@eazo/sdk/react";

import { HitlCard } from "./hitl-card";
import { Markdown } from "./markdown";
import { request } from "@/lib/request";
import type { MuseCard, MuseCardAction, MuseServerEvent, MuseSession } from "@/shared/muse-events";

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

function sessionLabel(s: MuseSession): string {
  const t = (s.title ?? "").trim();
  return t || "未命名会话";
}

/**
 * 把连续的 progress 碎片拼成可读文本。
 *
 * Qoni 把 agent 的推理按词/短语碎片逐条推来（"The" / "user" / "wants…"），
 * 这里按「是否像同一句的延续」决定用空格续写还是另起一行：
 * - 延续（新片段以小写/标点开头，或上一段没有以句末标点结束）→ 空格拼接；
 * - 否则（像工具步骤标签 读取网页 / agent_core.* 等）→ 换行，单独成行。
 */
function joinProgress(prevText: string, next: string): string {
  const prev = prevText.replace(/\s+$/, "");
  const frag = next.replace(/^\s+/, "");
  if (!prev) return frag;
  if (!frag) return prev;

  const prevEndsSentence = /[.!?。！？:：]$/.test(prev);
  const fragStartsContinuation = /^[a-z,.;:)\]'"”’\-—]/.test(frag);
  const continues = fragStartsContinuation || !prevEndsSentence;

  // 片段本身就是独立标签（纯工具名 / 短 CJK 动作）时，倾向换行。
  const looksLikeLabel = /^[\u4e00-\u9fa5]{2,8}$/.test(frag) || /^[a-z_]+\.[a-z_]+$/i.test(frag);

  if (continues && !looksLikeLabel) {
    // 同句延续：英文词/数字之间补一个空格，其余（含中文、紧跟的标点）直接相接。
    const needSpace =
      !/^[,.;:)\]'"”’]/.test(frag) && /[A-Za-z0-9)\]]$/.test(prev) && /^[A-Za-z0-9(\[]/.test(frag);
    return needSpace ? `${prev} ${frag}` : `${prev}${frag}`;
  }
  return `${prev}\n${frag}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return d.toLocaleDateString();
}

export default function ChatApp({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const authState = useEazo((s) => s.auth);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [cards, setCards] = useState<MuseCard[]>([]);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [sessions, setSessions] = useState<MuseSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  // 组件当前正在展示哪个会话（null = 新对话空态）。它是唯一的会话归属状态，
  // 由「URL -> effect」驱动；start 创建新会话时也先更新它再切 URL。
  // 初始化为 null（不读 prop）：这样首屏若 URL 带 id，effect 会发现不一致并回放。
  const [shownSessionId, setShownSessionId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refreshSessionsRef = useRef<() => void>(() => {});

  // PC 端会话栏：可折叠 + 可拖拽改宽（都持久化到 localStorage）。
  const RAIL_MIN = 180;
  const RAIL_MAX = 420;
  const RAIL_DEFAULT = 220;
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  const [railAnim, setRailAnim] = useState(true);
  const draggingRef = useRef(false);

  // 首帧从 localStorage 恢复偏好。
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

  // 拖拽改宽：pointer 事件，拖动中禁用选中/过渡，松手落盘。
  const startRailDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setRailAnim(false); // 拖拽期间关闭过渡，保证跟手
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX));
      setRailWidth(w);
    };
    const onUp = () => {
      draggingRef.current = false;
      setRailAnim(true); // 松手后恢复过渡
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

  const handleServerEvent = useCallback((ev: MuseServerEvent) => {
    // 回放/实时的第一条真实事件到达，撤掉 resume 加载态。
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
          return [...prev, { id: ev.messageId, role: "assistant", text: ev.text }];
        });
        break;
      case "progress":
        setItems((prev) => {
          const last = prev[prev.length - 1];
          // 连续的 progress 碎片合并进上一条，拼成一段话，而不是每条一行。
          if (last && last.role === "progress") {
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, text: joinProgress(last.text, ev.text) };
            return copy;
          }
          return [...prev, { id: `p-${Date.now()}-${Math.random()}`, role: "progress", text: ev.text }];
        });
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
        // 任务结束后刷新会话列表：新建的会话此时会带标题入列。
        refreshSessionsRef.current();
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

  // 连 SSE 收某个 run 的事件流（start 新 run 与回放历史会话共用）。
  const streamRun = useCallback(
    (runId: string) => {
      runIdRef.current = runId;
      esRef.current?.close();
      const es = new EventSource(`/api/webagent/stream?runId=${encodeURIComponent(runId)}`);
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
        setResuming(false);
        setRunning(false);
      };
    },
    [handleServerEvent],
  );

  const refreshSessions = useCallback(async () => {
    if (!authState.authenticated) return;
    setSessionsLoading(true);
    try {
      const res = await request("/api/webagent/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: MuseSession[] };
      setSessions(data.sessions ?? []);
    } catch {
      // 列表拉取失败不打断主流程，静默即可。
    } finally {
      setSessionsLoading(false);
    }
  }, [authState.authenticated]);

  useEffect(() => {
    refreshSessionsRef.current = () => {
      void refreshSessions();
    };
  }, [refreshSessions]);

  // 登录后拉一次会话列表。
  useEffect(() => {
    if (authState.authenticated) void refreshSessions();
    else setSessions([]);
  }, [authState.authenticated, refreshSessions]);

  // 重置到新对话空态（纯本地状态，不碰路由）。
  const resetToNew = useCallback(() => {
    esRef.current?.close();
    runIdRef.current = null;
    setShownSessionId(null);
    setItems([]);
    setCards([]);
    setLiveUrl(null);
    setResuming(false);
    setRunning(false);
  }, []);

  // 回放一个会话（按 id）：清空对话区、resume → attach 最新 run → 连 SSE 回放。
  const resumeSession = useCallback(
    async (id: string) => {
      esRef.current?.close();
      runIdRef.current = null;
      setShownSessionId(id);
      setItems([]);
      setCards([]);
      setLiveUrl(null);
      setRunning(true);
      setResuming(true);

      try {
        const res = await request("/api/webagent/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        });
        const data = await res.json();
        if (res.status === 401) throw new Error("请先登录");
        if (!res.ok) throw new Error(data?.error || "打开会话失败");

        if (data.empty || !data.runId) {
          // 会话还没跑过，没历史可回放；直接进可续聊的空态。
          setResuming(false);
          setRunning(false);
          return;
        }
        streamRun(data.runId);
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "progress",
            text: `打开会话出错：${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
        setResuming(false);
        setRunning(false);
      }
    },
    [streamRun],
  );

  // 导航动作只改 URL；真正的状态切换全部交给下面这个「URL 是唯一数据源」的 effect。
  const newConversation = useCallback(() => {
    if (running) return;
    setRailOpen(false);
    router.push("/");
  }, [running, router]);

  const selectSession = useCallback(
    (session: MuseSession) => {
      if (running || session.id === shownSessionId) return;
      setRailOpen(false);
      router.push(`/c/${session.id}`);
    },
    [running, shownSessionId, router],
  );

  // 唯一数据源：URL 里的 sessionId 变了才动作。
  // - 和当前展示的一致（含 start 新建后先同步 shownSessionId 的情况）：什么都不做，
  //   不会打断正在进行的实时流。
  // - 指向一个新 id：回放它。
  // - 变空（回到 /）：重置成新对话空态。
  useEffect(() => {
    if (!authState.authenticated) return; // 等登录态就绪
    const urlId = sessionId ?? null;
    if (urlId === shownSessionId) return;
    if (urlId) void resumeSession(urlId);
    else resetToNew();
  }, [sessionId, shownSessionId, authState.authenticated, resumeSession, resetToNew]);

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
          body: JSON.stringify({
            prompt,
            // 有当前会话则续聊；否则新建。
            sessionId: shownSessionId ?? undefined,
          }),
        });
        const data = await res.json();
        if (res.status === 401) throw new Error("请先登录");
        if (!res.ok) throw new Error(data?.error || "启动失败");

        runIdRef.current = data.runId;
        // 新建会话：先把 shownSessionId 设成新 id，再切 URL ——
        // 这样 URL effect 发现 urlId === shownSessionId，不会再回放一次，
        // 实时流不被打断。
        if (data.sessionId && data.sessionId !== shownSessionId) {
          setShownSessionId(data.sessionId);
          router.push(`/c/${data.sessionId}`);
        }
        streamRun(data.runId);
      } catch (err) {
        setItems((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "progress", text: `出错：${err instanceof Error ? err.message : String(err)}` },
        ]);
        setRunning(false);
      }
    },
    [running, handleServerEvent, authState.authenticated, streamRun, router, shownSessionId],
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
    <div
      className={`app${railOpen ? " app--rail-open" : ""}${railCollapsed ? " app--rail-collapsed" : ""}${railAnim ? " app--rail-anim" : ""}`}
      style={{ ["--rail-w" as string]: `${railWidth}px` }}
    >
      <div className="atmosphere" aria-hidden="true" />

      {railOpen && (
        <button
          type="button"
          className="rail-backdrop"
          aria-label="关闭会话列表"
          onClick={() => setRailOpen(false)}
        />
      )}

      <aside className="sessions">
        <div className="sessions__head">
          <div className="brand" style={{ fontSize: 14, letterSpacing: "0.16em" }}>
            会话
          </div>
          <div className="sessions__head-actions">
            <button
              type="button"
              className="sessions__new"
              onClick={newConversation}
              disabled={running}
              title="开一个全新会话"
            >
              + 新对话
            </button>
            <button
              type="button"
              className="rail-collapse"
              aria-label="收起侧边栏"
              title="收起侧边栏"
              onClick={toggleRailCollapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="rail-close"
              aria-label="收起会话列表"
              onClick={() => setRailOpen(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="sessions__list">
          {!authState.authenticated ? (
            <div className="sessions__empty">登录后，这里会列出你的历史会话。</div>
          ) : sessions.length === 0 ? (
            <div className="sessions__empty">
              {sessionsLoading ? "加载中…" : "还没有会话。说一句话就会创建第一个。"}
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`session-item${s.id === shownSessionId ? " session-item--on" : ""}`}
                onClick={() => selectSession(s)}
                disabled={running && s.id !== shownSessionId}
              >
                <div className="session-item__title">{sessionLabel(s)}</div>
                <div className="session-item__meta">
                  {s.status === "running" ? "进行中 · " : ""}
                  {formatWhen(s.updatedAt)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* PC 端拖拽改宽的手柄（窄屏抽屉模式下 CSS 隐藏）。 */}
        <div
          className="rail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整侧边栏宽度"
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

      <section className="shell">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="rail-open"
              aria-label="打开会话列表"
              onClick={() => setRailOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              className="rail-expand"
              aria-label="展开会话列表"
              title="展开侧边栏"
              onClick={toggleRailCollapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="brand">agent.</div>
          </div>
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
          {resuming ? (
            <div className="loading" role="status" aria-live="polite">
              <span className="loading__orb" aria-hidden="true" />
              <span className="loading__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="loading__text">正在载入这个会话…</span>
            </div>
          ) : items.length === 0 ? (
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
                  <div className={`reply${streaming ? " streaming" : ""}`}>
                    <Markdown>{it.text}</Markdown>
                  </div>
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
