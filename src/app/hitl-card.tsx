"use client";

import { useState } from "react";

import type { MuseCard, MuseCardAction } from "@/shared/muse-events";

interface Props {
  card: MuseCard;
  onAction: (action: Omit<MuseCardAction, "runId" | "interactionId">) => void;
  busy: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  site_login: "需要登录网站",
  take_control: "需要你亲手操作",
  ask_user: "Agent 有个问题",
  confirmation: "需要你确认",
  fill_form: "需要填写表单",
  wait: "等待中",
};

export function HitlCard({ card, onAction, busy }: Props) {
  const has = (k: string) => card.actions.includes(k);

  return (
    <div className="card">
      <div className="card__title">
        <span className="card__badge">{card.type}</span>
        {card.title || TYPE_LABEL[card.type] || "需要你处理"}
      </div>
      {card.prompt ? <div className="card__prompt">{card.prompt}</div> : null}

      {card.type === "ask_user" && (
        <AskUser card={card} onAction={onAction} busy={busy} has={has} />
      )}

      {card.type === "confirmation" && (
        <>
          {card.payload?.summary ? <div className="card__prompt">{card.payload.summary}</div> : null}
          <div className="card__actions">
            <button className="btn btn--ok" disabled={busy || !has("confirm")} onClick={() => onAction({ action: "confirm" })}>
              允许
            </button>
            <button className="btn btn--danger" disabled={busy || !has("reject")} onClick={() => onAction({ action: "reject" })}>
              拒绝
            </button>
          </div>
        </>
      )}

      {card.type === "site_login" && (
        <SiteLogin card={card} onAction={onAction} busy={busy} has={has} />
      )}

      {card.type === "take_control" && (
        <div className="card__actions">
          <button className="btn" disabled={busy || !has("connect_control")} onClick={() => onAction({ action: "connect_control" })}>
            接管浏览器
          </button>
          <button className="btn btn--ghost" disabled={busy || !has("release_control")} onClick={() => onAction({ action: "release_control" })}>
            交还控制
          </button>
        </div>
      )}

      {card.type === "fill_form" && (
        <FillForm card={card} onAction={onAction} busy={busy} has={has} />
      )}

      {has("skip") && (
        <div className="card__actions" style={{ marginTop: 8 }}>
          <button className="btn btn--ghost" disabled={busy} onClick={() => onAction({ action: "skip" })}>
            跳过
          </button>
        </div>
      )}
    </div>
  );
}

function AskUser({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const p = card.payload ?? {};
  const [text, setText] = useState("");
  const [multi, setMulti] = useState<string[]>([]);

  if (p.answerType === "single_choice") {
    return (
      <div className="option-row">
        {p.options?.map((o) => (
          <button key={o.value} className="chip" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: o.value })}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (p.answerType === "multiple_choice") {
    const toggle = (v: string) => setMulti((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]));
    return (
      <>
        <div className="option-row">
          {p.options?.map((o) => (
            <button key={o.value} className={`chip ${multi.includes(o.value) ? "chip--on" : ""}`} disabled={busy} onClick={() => toggle(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="card__actions">
          <button className="btn" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: multi })}>
            提交
          </button>
        </div>
      </>
    );
  }

  if (p.answerType === "boolean") {
    return (
      <div className="card__actions">
        <button className="btn btn--ok" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: true })}>
          是
        </button>
        <button className="btn btn--danger" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: false })}>
          否
        </button>
      </div>
    );
  }

  // text / number
  return (
    <div className="card__actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="field">
        <input
          type={p.answerType === "number" ? "number" : "text"}
          value={text}
          disabled={busy}
          placeholder="输入你的回答…"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <button
        className="btn"
        disabled={busy || !has("answer") || !text}
        onClick={() => onAction({ action: "answer", value: p.answerType === "number" ? Number(text) : text })}
      >
        回答
      </button>
    </div>
  );
}

function SiteLogin({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const sites = card.payload?.sites ?? [];
  return (
    <div className="card__actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
      {sites.length > 0 && (
        <div className="card__prompt">
          需要登录：{sites.map((s) => s.displayName || s.siteId).join("、")}
        </div>
      )}
      <div className="card__actions">
        <button
          className="btn"
          disabled={busy || !has("open_login")}
          onClick={() => onAction({ action: "open_login", value: sites[0]?.siteId })}
        >
          打开登录画面
        </button>
        <button className="btn btn--ok" disabled={busy || !has("confirm_signed_in")} onClick={() => onAction({ action: "confirm_signed_in" })}>
          我登录好了
        </button>
      </div>
    </div>
  );
}

function FillForm({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const fields = card.payload?.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <>
      {fields.map((f) => (
        <div className="field" key={f.name}>
          <label>
            {f.label || f.name}
            {f.required ? " *" : ""}
          </label>
          <input
            type={f.type === "number" ? "number" : "text"}
            value={values[f.name] ?? ""}
            disabled={busy}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </div>
      ))}
      <div className="card__actions">
        <button className="btn" disabled={busy || !has("submit")} onClick={() => onAction({ action: "submit", value: values })}>
          提交表单
        </button>
      </div>
    </>
  );
}
