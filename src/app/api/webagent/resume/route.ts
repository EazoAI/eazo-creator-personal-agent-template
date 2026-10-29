import { NextRequest, NextResponse } from "next/server";

import { Qoni } from "@qoniai/qoni";

import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import { createRunSession, finishRunSession, pushEvent } from "@/server/run-store";
import { driveRun, errMsg } from "@/server/drive-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 回放一个历史会话：重连其最新 run 并回放历史事件。
 *
 * 流程：
 * 1) requireAuth 解出可信用户（未登录 → 401）。
 * 2) 换令牌 → sessions.get(sessionId) 拿 latestRunId。
 * 3) doAnything.attach(latestRunId)：拿回 RunHandle；它的 wait() 会先回放该 run 的
 *    历史事件（对话 / 画面 / 卡片），若 run 仍在进行则继续跟进实时事件。
 * 4) 注册 run 会话、后台驱动 wait（复用 driveRun），返回 runId；前端连 SSE 收回放。
 *
 * 新建但从未跑过的会话没有 latestRunId —— 返回 { empty: true }，前端据此只切 active。
 */
export async function POST(req: NextRequest) {
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  let sessionId = "";
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON { sessionId }" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId 不能为空" }, { status: 400 });
  }

  try {
    const grant = await fetchWebAgentGrant(authed.userId);
    const app = new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });

    const summary = await app.doAnything.sessions.get({ token: grant.token, sessionId });
    const latestRunId = summary.latestRunId;
    if (!latestRunId) {
      // 会话还没有任何 run，无历史可回放。
      return NextResponse.json({ empty: true, sessionId });
    }

    const run = await app.doAnything.attach(latestRunId, { token: grant.token });

    const session = createRunSession(run.id, run);
    pushEvent(session, { kind: "ready", runId: run.id });

    // 后台驱动 wait()：先回放历史事件，再跟进实时（若仍在跑）。
    void driveRun(run, session.runId).catch((err) => {
      pushEvent(session, { kind: "error", message: errMsg(err) });
      finishRunSession(session.runId);
    });

    return NextResponse.json({ runId: run.id, sessionId });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
