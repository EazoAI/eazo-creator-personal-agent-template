"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getResolvedLocale } from "@/i18n";
import type { MuseCard, MuseCardAction } from "@/shared/muse-events";

interface Props {
  card: MuseCard;
  onAction: (action: Omit<MuseCardAction, "runId" | "interactionId">) => void;
  busy: boolean;
}

const HITL_TYPE_KEYS = [
  "site_login",
  "take_control",
  "ask_user",
  "confirmation",
  "fill_form",
  "wait",
] as const;

/** True once `expiresAt` has passed; re-evaluates when the deadline is reached. */
function useExpired(expiresAt: string | null | undefined): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const [expired, setExpired] = useState(() => Number.isFinite(deadline) && deadline <= Date.now());
  useEffect(() => {
    if (!Number.isFinite(deadline)) {
      setExpired(false);
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    // setTimeout caps at ~24.8 days; longer deadlines simply never fire here.
    if (left > 2_000_000_000) return;
    const timer = window.setTimeout(() => setExpired(true), left);
    return () => window.clearTimeout(timer);
  }, [deadline]);
  return expired;
}

export function HitlCard({ card, onAction, busy }: Props) {
  const { t } = useTranslation();
  const expired = useExpired(card.expiresAt);
  // Expired cards can no longer be acted on; the backend will settle them shortly.
  const has = (k: string) => !expired && card.actions.includes(k);
  const active = card.status === "active";

  const typeLabel = (HITL_TYPE_KEYS as readonly string[]).includes(card.type)
    ? t(`hitl.${card.type as (typeof HITL_TYPE_KEYS)[number]}`)
    : t("hitl.fallback");

  return (
    <div className={`card${active ? " card--active" : ""}`}>
      <div className="card__title">
        <span className="card__badge">{card.type}</span>
        {active ? <span className="card__badge card__badge--active">{t("hitl.active")}</span> : null}
        {expired ? <span className="card__badge card__badge--expired">{t("hitl.expired")}</span> : null}
        {card.title || typeLabel}
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
              {t("hitl.allow")}
            </button>
            <button className="btn btn--danger" disabled={busy || !has("reject")} onClick={() => onAction({ action: "reject" })}>
              {t("hitl.deny")}
            </button>
          </div>
        </>
      )}

      {card.type === "site_login" && (
        <SiteLogin card={card} onAction={onAction} busy={busy} has={has} />
      )}

      {card.type === "take_control" && (
        <div className="card__actions">
          {!active ? (
            <button className="btn" disabled={busy || !has("connect_control")} onClick={() => onAction({ action: "connect_control" })}>
              {t("hitl.takeOver")}
            </button>
          ) : (
            <>
              <button className="btn btn--ok" disabled={busy || !has("release_control")} onClick={() => onAction({ action: "release_control" })}>
                {t("hitl.release")}
              </button>
              {has("refresh_control") && (
                <button className="btn btn--ghost" disabled={busy} onClick={() => onAction({ action: "refresh_control" })}>
                  {t("hitl.refreshControl")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {card.type === "fill_form" && (
        <FillForm card={card} onAction={onAction} busy={busy} has={has} />
      )}

      {has("skip") && (
        <div className="card__actions" style={{ marginTop: 8 }}>
          <button className="btn btn--ghost" disabled={busy} onClick={() => onAction({ action: "skip" })}>
            {t("hitl.skip")}
          </button>
        </div>
      )}
    </div>
  );
}

function AskUser({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const { t } = useTranslation();
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
            <button key={o.value} className={`chip ${multi.includes(o.value) ? "chip--on" : ""}`} disabled={busy || !has("answer")} onClick={() => toggle(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="card__actions">
          <button className="btn" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: multi })}>
            {t("hitl.submit")}
          </button>
        </div>
      </>
    );
  }

  if (p.answerType === "boolean") {
    return (
      <div className="card__actions">
        <button className="btn btn--ok" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: true })}>
          {t("hitl.yes")}
        </button>
        <button className="btn btn--danger" disabled={busy || !has("answer")} onClick={() => onAction({ action: "answer", value: false })}>
          {t("hitl.no")}
        </button>
      </div>
    );
  }

  return (
    <div className="card__actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="field">
        <input
          type={p.answerType === "number" ? "number" : "text"}
          value={text}
          disabled={busy || !has("answer")}
          placeholder={t("hitl.answerPlaceholder")}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <button
        className="btn"
        disabled={busy || !has("answer") || !text}
        onClick={() => onAction({ action: "answer", value: p.answerType === "number" ? Number(text) : text })}
      >
        {t("hitl.answer")}
      </button>
    </div>
  );
}

function SiteLogin({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const { t } = useTranslation();
  const locale = getResolvedLocale();
  const sites = card.payload?.sites ?? [];
  const sep = locale === "zh" ? "、" : ", ";
  return (
    <div className="card__actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
      {sites.length > 0 && (
        <div className="card__prompt">
          {t("hitl.loginSites", { sites: sites.map((s) => s.displayName || s.siteId).join(sep) })}
        </div>
      )}
      <div className="card__actions">
        <button
          className="btn"
          disabled={busy || !has("open_login")}
          onClick={() => onAction({ action: "open_login", value: sites[0]?.siteId })}
        >
          {t("hitl.openLogin")}
        </button>
        <button className="btn btn--ok" disabled={busy || !has("confirm_signed_in")} onClick={() => onAction({ action: "confirm_signed_in" })}>
          {t("hitl.signedIn")}
        </button>
      </div>
    </div>
  );
}

function FillForm({ card, onAction, busy, has }: Props & { has: (k: string) => boolean }) {
  const { t } = useTranslation();
  const fields = card.payload?.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const canSubmit = has("submit");
  const missing = fields.some((f) => f.required && !values[f.name]?.trim());
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
            disabled={busy || !canSubmit}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </div>
      ))}
      <div className="card__actions">
        <button className="btn" disabled={busy || !canSubmit || missing} onClick={() => onAction({ action: "submit", value: values })}>
          {t("hitl.submitForm")}
        </button>
      </div>
    </>
  );
}
