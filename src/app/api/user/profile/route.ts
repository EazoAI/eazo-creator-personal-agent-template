import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@eazo/sdk/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user/profile
 *
 * @eazo/sdk 前端在登录后会固定请求这个「app 本地」端点（永远不带平台前缀），
 * 用它把加密的 x-eazo-session 换成当前登录用户资料。
 *
 * 这里用本 app 的 EAZO_PRIVATE_KEY 解 session（requireAuth），返回 { ok, user }。
 * Web 与 Mobile 发的 session 形状一致，同一套处理即可。
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, user: auth.user });
}
