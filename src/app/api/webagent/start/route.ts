import { NextRequest, NextResponse } from "next/server";

import { QoniScopes } from "@qoniai/qoni";

import { apiMessage } from "@/lib/i18n/api";
import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import { errMsg, isBusySessionError } from "@/server/run-errors";
import { Qoni } from "@qoniai/qoni";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  let prompt = "";
  let sessionId: string | undefined;
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").trim();
    sessionId = body?.sessionId ? String(body.sessionId) : undefined;
  } catch {
    return NextResponse.json({ error: apiMessage("bodyJsonPrompt") }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: apiMessage("promptRequired") }, { status: 400 });
  }

  try {
    const userId = authed.userId;
    const grant = await fetchWebAgentGrant(userId);

    const app = new Qoni({ webAgentHost: grant.webAgentHost ?? undefined });

    let run;
    try {
      run = await app.doAnything.run({
        token: grant.token,
        prompt,
        taskScopes: [
          QoniScopes.SITE_LOGIN_REQUEST,
          QoniScopes.SITE_LOGIN_CONFIRM,
          QoniScopes.BROWSER_USE_TAKE_CONTROL,
        ],
        session: sessionId ? { sessionId } : undefined,
      });
    } catch (err) {
      if (sessionId && isBusySessionError(err)) {
        return NextResponse.json({ error: apiMessage("sessionBusy") }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({
      grant: { token: grant.token, webAgentHost: grant.webAgentHost },
      runId: run.id,
      sessionId: run.sessionRef?.sessionId ?? sessionId ?? null,
      sessionRef: run.sessionRef ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
