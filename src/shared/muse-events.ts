/**
 * 前端 / 服务端共享的 SSE 事件契约。
 *
 * 服务端把 Qoni 的 RunEvent / InteractionHandle 归一成这组精简事件推给前端；
 * 前端只认这组事件，不直接接触 Qoni 令牌、host 或 wire 格式。
 */

export type MuseRole = "assistant";

/** 一类 HITL 卡片的精简投影（前端渲染用；真正的动作仍在服务端执行）。 */
export interface MuseCard {
  /** 稳定 id，贯穿卡片生命周期；前端按 id 更新同一张卡。 */
  id: string;
  type: "site_login" | "take_control" | "ask_user" | "confirmation" | "fill_form" | "wait";
  status: "pending" | "resolved" | "expired" | string;
  title: string;
  prompt?: string | null;
  /** 该卡当前声明可用的动作（驱动前端按钮）。 */
  actions: string[];
  /** 类型相关的投影，够前端渲染即可。 */
  payload?: {
    // ask_user
    question?: string;
    answerType?: "text" | "number" | "boolean" | "single_choice" | "multiple_choice";
    options?: { value: string; label: string }[];
    // confirmation
    summary?: string;
    // site_login
    sites?: { siteId: string; displayName: string; loginUrl: string }[];
    // take_control / 实时画面
    liveUrl?: string;
    // fill_form
    fields?: { name: string; label?: string; required?: boolean; type?: string }[];
  };
}

/**
 * 一条会话的精简投影（前端会话列表用）。
 *
 * 直接来自 Qoni 原生的 doAnything.sessions.list —— 令牌按登录用户签发，
 * 所以列表天然就是当前用户自己的会话，无需我们自建存储。
 */
export interface MuseSession {
  id: string;
  title: string | null;
  status: "created" | "idle" | "running" | "stopped" | "timed_out" | "error" | string;
  /** 该会话最新一个 run；续聊 / 回放都以它为锚。 */
  latestRunId: string | null;
  updatedAt: string;
}

/** 服务端 → 前端的 SSE 事件。 */
export type MuseServerEvent =
  | { kind: "ready"; runId: string }
  /** 流式回答：按 messageId 更新同一气泡；text 是「到目前为止的完整回答」。 */
  | { kind: "message"; messageId: string; text: string; done: boolean }
  /** 进度文字（可选展示）。 */
  | { kind: "progress"; text: string }
  /** 实时浏览器画面地址变化（放进 iframe）。url 带访问凭证，不落日志。 */
  | { kind: "screen"; liveUrl: string }
  /** HITL 卡片创建 / 更新。 */
  | { kind: "card"; card: MuseCard }
  /** 任务结束。 */
  | { kind: "done"; status: string; output?: string; terminalReason?: string }
  /** 出错。 */
  | { kind: "error"; message: string };

/** 前端 → 服务端：对某张 HITL 卡片执行一个动作。 */
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
    | "release_control"
    | "skip";
  /** answer 的值 / submit 的表单值 / open_login 的 siteId。 */
  value?: unknown;
}
