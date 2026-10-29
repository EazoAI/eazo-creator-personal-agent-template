import { NextRequest, NextResponse } from "next/server";

import { QoniScopes, type RunEvent, type InteractionHandle, type RunHandle } from "@qoniai/qoni";

import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import { mapRunEvent, toMuseCard } from "@/server/event-map";
import {
  createRunSession,
  finishRunSession,
  pushEvent,
  registerInteraction,
} from "@/server/run-store";
import { Qoni } from "@qoniai/qoni";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 起一个 DoAnything 任务。
 *
 * 流程：
 * 1) 用 @eazo/sdk requireAuth 解出可信的当前登录用户 ID（未登录 → 401）。
 * 2) 用 app 私钥向 Eazo 平台换令牌，拿到 { token, webAgentHost }（本 app 不持 Qoni Key）。
 * 3) 用无 Key 客户端（只认 webAgentHost）起 run —— 和「app 不持 Key」的生产姿势一致。
 * 4) 注册 run 会话，后台异步驱动 run.wait，把事件灌进 run-store。
 * 5) 返回 runId；前端用它连 SSE。
 */
export async function POST(req: NextRequest) {
  // 身份硬约束：user_id 只来自已验证的 Eazo 登录态，忽略 body 里任何 id。
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  let prompt = "";
  let sessionId: string | undefined;
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").trim();
    sessionId = body?.sessionId ? String(body.sessionId) : undefined;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON { prompt }" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }

  try {
    const userId = authed.userId;
    const grant = await fetchWebAgentGrant(userId);

    // 无 Key 客户端：只认 webAgentHost，令牌单独传。这正是生产里 app 的姿势。
    const app = new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });

    const run = await app.doAnything.run({
      token: grant.token,
      prompt,
      // 任务可能需要用户亲手操作（验证码/付款）→ 声明接管 scope。
      taskScopes: [
        QoniScopes.SITE_LOGIN_REQUEST,
        QoniScopes.SITE_LOGIN_CONFIRM,
        QoniScopes.BROWSER_USE_TAKE_CONTROL,
      ],
      session: sessionId ? { sessionId } : undefined,
    });

    const session = createRunSession(run.id, run);
    pushEvent(session, { kind: "ready", runId: run.id });

    // 后台驱动 run.wait —— 不 await，让它独立跑到终态。
    void driveRun(run, session.runId).catch((err) => {
      pushEvent(session, { kind: "error", message: errMsg(err) });
      finishRunSession(session.runId);
    });

    return NextResponse.json({ runId: run.id, sessionRef: run.sessionRef ?? null });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}

async function driveRun(run: RunHandle, runId: string) {
  const { getRunSession } = await import("@/server/run-store");
  const session = getRunSession(runId);
  if (!session) return;

  try {
    await run.wait({
      timeoutMs: 15 * 60 * 1000,
      onEvent: (e: RunEvent) => {
        const mapped = mapRunEvent(e);
        if (mapped) pushEvent(session, mapped);
      },
      onInteraction: (handle: InteractionHandle) => {
        // 只处理 pending，按 id 去重由前端 + handle 自身保证。
        if (handle.status !== "pending") return;
        registerInteraction(session, handle);
        pushEvent(session, { kind: "card", card: toMuseCard(handle) });
      },
    });
  } finally {
    finishRunSession(runId);
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
