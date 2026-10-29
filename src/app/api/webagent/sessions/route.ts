import { NextRequest, NextResponse } from "next/server";

import { Qoni, type SessionSummary } from "@qoniai/qoni";

import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import type { MuseSession } from "@/shared/muse-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 列出「当前登录用户」的历史会话。
 *
 * 为什么不用自建存储：
 * - 令牌由 Eazo 平台按可信登录用户签发（fetchWebAgentGrant(userId)）；
 * - doAnything.sessions.list({ token }) 返回的天然就是该令牌主人的会话。
 * 所以会话隔离完全交给 Qoni 原生能力，本 app 不维护任何会话表。
 */
export async function GET(req: NextRequest) {
  // 身份硬约束：user_id 只来自已验证的 Eazo 登录态。
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  try {
    const grant = await fetchWebAgentGrant(authed.userId);
    const app = new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });

    const summaries = await app.doAnything.sessions.list({
      token: grant.token,
      limit: 30,
    });

    const sessions: MuseSession[] = summaries.map(toMuseSession);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Qoni SessionSummary → 前端会话列表用的精简投影。 */
function toMuseSession(s: SessionSummary): MuseSession {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    latestRunId: s.latestRunId,
    updatedAt: s.updatedAt,
  };
}
