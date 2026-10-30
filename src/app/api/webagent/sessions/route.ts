import { NextRequest, NextResponse } from "next/server";

import { Qoni, type SessionSummary } from "@qoniai/qoni";

import { fetchWebAgentGrant, resolveAuthedUserId } from "@/server/qoni";
import type { MuseSession } from "@/shared/muse-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List history sessions for the currently signed-in user.
 *
 * Why there is no app-owned store:
 * - The token is issued by the Eazo platform for the verified user
 *   (fetchWebAgentGrant(userId));
 * - doAnything.sessions.list({ token }) returns only that token owner's sessions.
 * Session isolation is delegated to Qoni; this app keeps no session table.
 */
export async function GET(req: NextRequest) {
  // Hard identity rule: user_id comes only from a verified Eazo session.
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

/** Qoni SessionSummary → slim projection for the sidebar list. */
function toMuseSession(s: SessionSummary): MuseSession {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    latestRunId: s.latestRunId,
    updatedAt: s.updatedAt,
  };
}
