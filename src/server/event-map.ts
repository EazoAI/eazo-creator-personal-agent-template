import "server-only";

import {
  QoniEventTypes,
  type AgentBrowser,
  type Interaction,
  type InteractionHandle,
  type RunEvent,
} from "@qoniai/qoni";

import type { MuseCard, MuseServerEvent } from "@/shared/muse-events";

/** 把一个 Qoni RunEvent 归一成 MuseServerEvent（不认识的返回 null，跳过）。 */
export function mapRunEvent(event: RunEvent): MuseServerEvent | null {
  // RunEvent 是按 type 区分的联合；统一从一个宽松视图读 data，避免联合收窄到 never。
  const ev = event as { type: string; data: unknown };
  switch (ev.type) {
    case QoniEventTypes.Message: {
      const data = ev.data as { id: string; text: string; done?: boolean };
      return { kind: "message", messageId: data.id, text: data.text ?? "", done: Boolean(data.done) };
    }
    case QoniEventTypes.Progress: {
      const text = typeof ev.data === "string" ? ev.data : String(ev.data ?? "");
      if (!text) return null;
      return { kind: "progress", text };
    }
    case QoniEventTypes.Browsers: {
      const browsers = ev.data as AgentBrowser[];
      // AgentBrowser.url 就是可嵌 iframe 的实时画面地址；取 lead（id === "main"）优先。
      const lead = Array.isArray(browsers)
        ? browsers.find((b) => b?.id === "main" && b?.url) ?? browsers.find((b) => b?.url)
        : undefined;
      if (!lead?.url) return null;
      return { kind: "screen", liveUrl: lead.url };
    }
    case QoniEventTypes.BrowserLiveUrlChanged: {
      const data = ev.data as { liveUrl: string };
      if (!data?.liveUrl) return null;
      return { kind: "screen", liveUrl: data.liveUrl };
    }
    case QoniEventTypes.Done: {
      const data = ev.data as { output?: string; succeeded?: boolean; terminalReason?: string };
      return {
        kind: "done",
        status: data.succeeded ? "succeeded" : "failed",
        output: data.output,
        terminalReason: data.terminalReason,
      };
    }
    default:
      return null;
  }
}

/** 把一个 InteractionHandle（含其底层 interaction）投影成前端渲染用的 MuseCard。 */
export function toMuseCard(handle: InteractionHandle): MuseCard {
  const it = handle.interaction as Interaction;
  const card: MuseCard = {
    id: it.id,
    type: it.type,
    status: it.status,
    title: it.title,
    prompt: it.prompt ?? null,
    actions: (it.actions ?? []).map((a) => a.kind),
    payload: {},
  };

  switch (it.type) {
    case "ask_user": {
      const p = it.payload;
      card.payload = {
        question: p.question,
        answerType: p.answerType,
        options: p.options?.map((o) => ({ value: o.value, label: o.label })),
      };
      break;
    }
    case "confirmation": {
      card.payload = { summary: it.payload.summary };
      break;
    }
    case "site_login": {
      card.payload = {
        sites: it.payload.sites?.map((s) => ({
          siteId: s.siteId,
          displayName: s.displayName,
          loginUrl: s.loginUrl,
        })),
      };
      break;
    }
    case "take_control": {
      card.payload = { liveUrl: it.payload.liveUrl };
      break;
    }
    case "fill_form": {
      // FillFormPayload.fields 结构随版本可能变化，做宽松投影。
      const fields = (it.payload as { fields?: unknown[] }).fields ?? [];
      card.payload = {
        fields: fields.map((f) => {
          const field = f as { name: string; label?: string; required?: boolean; type?: string };
          return {
            name: field.name,
            label: field.label,
            required: field.required,
            type: field.type,
          };
        }),
      };
      break;
    }
    default:
      break;
  }

  return card;
}
