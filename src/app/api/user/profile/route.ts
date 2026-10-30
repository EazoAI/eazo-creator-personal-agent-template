import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@eazo/sdk/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user/profile
 *
 * After sign-in, @eazo/sdk always calls this app-local endpoint (never with a
 * platform prefix) to exchange the encrypted x-eazo-session for the current
 * user profile.
 *
 * Decrypt the session with this app's EAZO_PRIVATE_KEY (requireAuth) and return
 * { ok, user }. Web and Mobile send the same session shape, so one handler
 * covers both.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, user: auth.user });
}
