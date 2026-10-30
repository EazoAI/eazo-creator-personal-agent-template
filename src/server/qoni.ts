import "server-only";

import { requireAuth } from "@eazo/sdk/server";

/**
 * Exchange the current Eazo login for a WebAgent grant from the Eazo platform.
 *
 * Production shape:
 * - This app (Muse) holds no Qoni keys.
 * - The platform backend issues tokens using its own auth plus a super key.
 * - This app's server forwards the verified Eazo session to the platform grant API.
 *
 * Security: Qoni super keys live only on the Eazo platform backend. After exchange,
 * grant.token (user-scoped, expiring) may be sent to the browser for direct WebAgent
 * access; app private keys never leave the server.
 */

export interface WebAgentGrant {
  token: string;
  webAgentHost: string | null;
  expiresAt: number; // ms
  scopes: string[];
  products: string[];
}

/** Eazo platform root (shared with @eazo/sdk), e.g. https://eazo.ai */
function platformRoot(): string {
  const base = process.env.EAZO_PLATFORM_API_BASE;
  if (!base) {
    throw new Error("Missing EAZO_PLATFORM_API_BASE; set the Eazo platform URL in .env.local");
  }
  return base.replace(/\/+$/, "");
}

/**
 * Resolve the current signed-in user via @eazo/sdk requireAuth.
 *
 * requireAuth reads `x-eazo-session` (injected by EazoProvider / auth.getSessionHeader),
 * decrypts with EAZO_PRIVATE_KEY, and returns a trusted user.id from the GenAuth pool.
 *
 * Security: user_id must come only from this verified session, never from the client body.
 */
type AuthedUser =
  | { ok: true; userId: string; email: string | null; name: string | null }
  | { ok: false; response: Response };

export function resolveAuthedUserId(request: {
  headers: { get(name: string): string | null };
}): AuthedUser {
  const auth = requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, userId: String(auth.user.id), email: auth.user.email, name: auth.user.name };
}

/**
 * Exchange app credentials for a WebAgent grant for the given trusted end-user id.
 *
 * @param userId Terminal user id from requireAuth(x-eazo-session).
 */
export async function fetchWebAgentGrant(userId: string): Promise<WebAgentGrant> {
  const appId = process.env.EAZO_APP_ID;
  const privateKey = process.env.EAZO_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error("Missing EAZO_APP_ID / EAZO_PRIVATE_KEY; configure them in .env.local");
  }

  const res = await fetch(`${platformRoot()}/creator/api/webagent/grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-eazo-app-id": appId,
      Authorization: `Bearer ${privateKey}`,
    },
    body: JSON.stringify({ app_id: appId, user_id: userId }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("App authentication failed (check EAZO_APP_ID / EAZO_PRIVATE_KEY)");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Platform failed to issue WebAgent token (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as Partial<WebAgentGrant>;
  if (!data?.token) {
    throw new Error("Platform did not return a WebAgent token");
  }
  return {
    token: data.token,
    webAgentHost: data.webAgentHost ?? process.env.QONI_WEBAGENT_HOST ?? null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : Date.now() + 24 * 3600 * 1000,
    scopes: data.scopes ?? [],
    products: data.products ?? [],
  };
}
