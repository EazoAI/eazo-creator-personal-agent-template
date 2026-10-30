import { NextRequest, NextResponse } from "next/server";

import { Qoni } from "@qoniai/qoni";

import { apiMessage } from "@/lib/i18n/api";
import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import { errMsg } from "@/server/run-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  let sessionId = "";
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId ?? "").trim();
  } catch {
    return NextResponse.json({ error: apiMessage("bodyJsonSessionId") }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: apiMessage("sessionIdRequired") }, { status: 400 });
  }

  try {
    const grant = await fetchWebAgentGrant(authed.userId);
    const app = new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });

    const summary = await app.doAnything.sessions.get({ token: grant.token, sessionId });
    const latestRunId = summary.latestRunId;
    if (!latestRunId) {
      return NextResponse.json({ empty: true, sessionId });
    }

    return NextResponse.json({
      grant: { token: grant.token, webAgentHost: grant.webAgentHost },
      runId: latestRunId,
      sessionId,
      sessionRef: { sessionId },
    });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
