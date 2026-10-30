"use client";

import { useTranslation } from "react-i18next";

import type { MuseStep } from "@/shared/muse-events";

export function StepItem({ step }: { step: MuseStep }) {
  const { t } = useTranslation();
  const notes = step.notes ?? [];
  const head = (
    <>
      <i className={`step__icon step__icon--${step.status}`} aria-hidden="true" />
      <span className="step__label">{step.label}</span>
      {step.status === "failed" ? <span className="step__meta">{t("step.failed")}</span> : null}
      {step.durationMs !== undefined && step.status !== "running" ? (
        <span className="step__meta">{(step.durationMs / 1000).toFixed(1)}s</span>
      ) : null}
    </>
  );
  if (notes.length === 0 && !step.error) {
    return <div className={`message step step--${step.status}`}>{head}</div>;
  }
  return (
    <details className={`message step step--${step.status}`}>
      <summary>{head}</summary>
      {step.error ? <div className="step__error">{step.error}</div> : null}
      {notes.length > 0 ? (
        <ul className="step__notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
