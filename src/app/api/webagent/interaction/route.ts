import { NextRequest, NextResponse } from "next/server";

import type { AskUserAnswer, FormValues } from "@qoniai/qoni";

import { getRunSession, pushEvent, registerInteraction } from "@/server/run-store";
import { resolveAuthedUserId } from "@/server/qoni";
import { toMuseCard } from "@/server/event-map";
import type { MuseCardAction } from "@/shared/muse-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 前端回传一张 HITL 卡片的用户操作。
 * 服务端用注册过的 InteractionHandle 执行对应动作。
 *
 * 规则（Qoni 契约）：
 * - 只对 status === "pending" 的卡操作；
 * - 只调 handle.can(kind) 声明过的动作，否则 handle 会抛错；
 * - 对已结束/被替换的卡操作会得到 409 —— 直接把错误回给前端，不自动重试。
 */
export async function POST(req: NextRequest) {
  // 必须登录才能操作卡片。
  const authed = resolveAuthedUserId(req);
  if (!authed.ok) return authed.response;

  let action: MuseCardAction;
  try {
    action = (await req.json()) as MuseCardAction;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const session = getRunSession(action.runId);
  if (!session) {
    return NextResponse.json({ error: "unknown runId" }, { status: 404 });
  }
  const handle = session.interactions.get(action.interactionId);
  if (!handle) {
    return NextResponse.json({ error: "unknown interactionId" }, { status: 404 });
  }

  try {
    switch (action.action) {
      case "answer":
        await handle.answer(action.value as AskUserAnswer);
        break;
      case "confirm":
        await handle.confirm();
        break;
      case "reject":
        await handle.reject();
        break;
      case "submit":
        await handle.submit(action.value as FormValues);
        break;
      case "skip":
        await handle.skip();
        break;
      case "open_login": {
        const siteId = action.value ? String(action.value) : undefined;
        const login = await handle.openLogin(siteId ? { siteId } : undefined);
        // 把登录画面的 liveUrl 回推前端，让用户在 iframe 里登录。
        pushEvent(session, { kind: "screen", liveUrl: login.liveUrl });
        // 同步把卡片的最新投影推一次（状态可能变化）。
        pushEvent(session, { kind: "card", card: toMuseCard(handle) });
        registerInteraction(session, handle);
        return NextResponse.json({ ok: true, liveUrl: login.liveUrl });
      }
      case "confirm_signed_in":
        await handle.confirmSignedIn();
        break;
      case "connect_control": {
        const control = await handle.connectControl();
        const payload = handle.interaction.payload as { liveUrl?: string };
        const liveUrl = control?.liveUrl ?? payload?.liveUrl;
        if (liveUrl) pushEvent(session, { kind: "screen", liveUrl });
        return NextResponse.json({ ok: true, liveUrl });
      }
      case "release_control":
        await handle.releaseControl();
        break;
      default:
        return NextResponse.json({ error: `不支持的动作: ${action.action}` }, { status: 400 });
    }

    // 动作后把卡片最新状态推一次。
    pushEvent(session, { kind: "card", card: toMuseCard(handle) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 409（卡已结束/被替换）等错误原样回前端，不自动重试。
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
