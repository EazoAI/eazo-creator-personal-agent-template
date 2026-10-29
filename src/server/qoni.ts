import "server-only";

import { requireAuth } from "@eazo/sdk/server";

/**
 * 向 Eazo 平台换取 WebAgent 令牌。
 *
 * 架构（生产形态）：
 * - 本 app（Muse）不持任何 Qoni Key。
 * - 令牌由 Eazo 平台后端签发：平台用自己的登录态确认身份 + 超级 Key 静默换令牌。
 * - 本 app 服务端只把「当前登录用户的 Eazo 令牌」转发给平台接口，拿回 grant。
 *
 * 安全：Qoni 超级 Key 只在 Eazo 平台后端，本仓库 / 前端 / 日志里都没有。
 * 本 app 服务端也不长期持有 grant.token 之外的东西，令牌不下发前端。
 */

export interface WebAgentGrant {
  token: string;
  webAgentHost: string | null;
  expiresAt: number; // ms
  scopes: string[];
  products: string[];
}

/** Eazo 平台根地址（与 @eazo/sdk 共用），例如 https://eazo.ai 。 */
function platformRoot(): string {
  const base = process.env.EAZO_PLATFORM_API_BASE;
  if (!base) {
    throw new Error("缺少 EAZO_PLATFORM_API_BASE，请在 .env.local 配置 Eazo 平台地址");
  }
  return base.replace(/\/+$/, "");
}

/**
 * 解析「当前登录用户」—— 用 @eazo/sdk 的 requireAuth。
 *
 * requireAuth 读请求头 `x-eazo-session`（前端 EazoProvider / auth.getSessionHeader 注入），
 * 用本 app 的 EAZO_PRIVATE_KEY 解密，返回可信的 user。user.id 就是 Eazo GenAuth 用户池
 * 里的真实用户 ID —— 这一步是密码学可信的，随后作为令牌身份传给平台。
 *
 * 安全红线：user_id 只能来自这里（已验证的 session），绝不能来自前端/body 传值。
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
 * 用「app 私钥 + app_id」向平台换 WebAgent 令牌。
 *
 * 平台用 app 私钥确认调用方是合法 app（app-ai 同款模型），
 * 用 userId（已由 app 侧 requireAuth 解出的可信终端用户）作为令牌身份。
 *
 * @param userId app 侧 requireAuth(x-eazo-session) 解出的可信终端用户 ID。
 */
export async function fetchWebAgentGrant(userId: string): Promise<WebAgentGrant> {
  const appId = process.env.EAZO_APP_ID;
  const privateKey = process.env.EAZO_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error("缺少 EAZO_APP_ID / EAZO_PRIVATE_KEY，请在 .env.local 配置");
  }

  // 换令牌接口在平台的 /creator/api 下，路径写全。
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
    throw new Error("app 身份校验失败（检查 EAZO_APP_ID / EAZO_PRIVATE_KEY）");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`平台签发 WebAgent 令牌失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as Partial<WebAgentGrant>;
  if (!data?.token) {
    throw new Error("平台未返回 WebAgent 令牌");
  }
  return {
    token: data.token,
    webAgentHost: data.webAgentHost ?? process.env.QONI_WEBAGENT_HOST ?? null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : Date.now() + 24 * 3600 * 1000,
    scopes: data.scopes ?? [],
    products: data.products ?? [],
  };
}
