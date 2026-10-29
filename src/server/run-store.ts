import "server-only";

import type { InteractionHandle, RunHandle } from "@qoniai/qoni";

import type { MuseServerEvent } from "@/shared/muse-events";

/**
 * 服务端活跃 run 注册表。
 *
 * 为什么需要它：
 * - `run.wait({ onEvent, onInteraction })` 是一个阻塞式 Promise，事件从回调里来；
 *   而 SSE 端点要持续把事件推给前端 —— 两者用一个「事件队列」解耦。
 * - HITL 卡片的用户操作由前端异步回传，但执行动作需要服务端的 InteractionHandle；
 *   所以要按 interactionId 存住 handle，回传时查出来执行。
 *
 * demo 用进程内 Map 即可；生产应换成按用户隔离的持久化 / 分布式方案。
 */

type Waiter = (ev: MuseServerEvent) => void;

interface RunSession {
  runId: string;
  run: RunHandle;
  /** 已入队、等待被 SSE 消费的事件。 */
  queue: MuseServerEvent[];
  /** 当前挂起的 SSE 消费者（拿到事件就 resolve）。 */
  waiter: Waiter | null;
  /** 活跃的 HITL handle，按 interactionId 存。 */
  interactions: Map<string, InteractionHandle>;
  /** run 是否已结束。 */
  finished: boolean;
}

const sessions = new Map<string, RunSession>();

export function createRunSession(runId: string, run: RunHandle): RunSession {
  const session: RunSession = {
    runId,
    run,
    queue: [],
    waiter: null,
    interactions: new Map(),
    finished: false,
  };
  sessions.set(runId, session);
  return session;
}

export function getRunSession(runId: string): RunSession | undefined {
  return sessions.get(runId);
}

/** 服务端把一个事件投递给前端（入队或直接唤醒挂起的消费者）。 */
export function pushEvent(session: RunSession, ev: MuseServerEvent): void {
  if (session.waiter) {
    const w = session.waiter;
    session.waiter = null;
    w(ev);
  } else {
    session.queue.push(ev);
  }
}

/** SSE 端点拉下一个事件（有则立即返回，无则等待）。 */
export function pullEvent(session: RunSession): Promise<MuseServerEvent | null> {
  if (session.queue.length > 0) {
    return Promise.resolve(session.queue.shift()!);
  }
  if (session.finished) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    session.waiter = (ev) => resolve(ev);
  });
}

export function registerInteraction(session: RunSession, handle: InteractionHandle): void {
  session.interactions.set(handle.id, handle);
}

export function finishRunSession(runId: string): void {
  const session = sessions.get(runId);
  if (!session) return;
  session.finished = true;
  // 唤醒可能挂起的消费者，让它收到 null 结束。
  if (session.waiter) {
    const w = session.waiter;
    session.waiter = null;
    w(null as unknown as MuseServerEvent);
  }
  // 稍后清理，给 SSE 收尾留时间。
  setTimeout(() => sessions.delete(runId), 30_000);
}
