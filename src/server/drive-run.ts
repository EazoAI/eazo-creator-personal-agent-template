import "server-only";

import {
  QoniEventTypes,
  type Interaction,
  type RunEvent,
  type RunHandle,
} from "@qoniai/qoni";

import { mapRunEvent, toMuseCard } from "@/server/event-map";
import {
  finishRunSession,
  getRunSession,
  pushEvent,
  registerInteraction,
} from "@/server/run-store";

/**
 * 后台消费一个 RunHandle 的事件流，把事件灌进 run-store。
 *
 * 用 run.events()（异步迭代器）而不是 wait({onEvent})：
 * - events() 会先回放该 run 的历史事件（backfill），再跟进实时，终态自动结束；
 *   这对「回放历史会话（attach 一个已终结的 run）」是必须的 —— wait() 对终态 run
 *   会直接从 run-detail 落定、不重新吐历史事件，导致历史消息加载不出来。
 * - 对「续聊起的新 run」同样适用：events() 从头跟到终态。
 *
 * 所以 start（新 run）与 resume（回放）共用这一套。
 */
export async function driveRun(run: RunHandle, runId: string): Promise<void> {
  const session = getRunSession(runId);
  if (!session) return;

  try {
    for await (const event of run.events()) {
      if (event.type === QoniEventTypes.Interaction) {
        // interaction 事件的 data 是 Interaction 对象；包成 handle 以便前端回传动作。
        const interaction = event.data as Interaction;
        const handle = run.interactionHandle(interaction);
        // 只处理 pending（回放已结束的 run 时，历史 interaction 多为已 settle，跳过）。
        if (handle.status !== "pending") continue;
        registerInteraction(session, handle);
        pushEvent(session, { kind: "card", card: toMuseCard(handle) });
        continue;
      }
      const mapped = mapRunEvent(event as RunEvent);
      if (mapped) pushEvent(session, mapped);
    }
  } finally {
    finishRunSession(runId);
  }
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 续聊时「该会话上一轮未结束」的冲突：HTTP 409 或 conflict 类错误码。 */
export function isBusySessionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string };
  if (e.status === 409) return true;
  if (typeof e.code === "string" && e.code.toLowerCase().includes("conflict")) return true;
  return false;
}
