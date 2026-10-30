"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function Composer({
  running,
  stopping,
  onStart,
  onStop,
}: {
  running: boolean;
  stopping: boolean;
  onStart: (prompt: string) => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input]);

  const submit = () => {
    const prompt = input;
    if (!prompt.trim() || running) return;
    setInput("");
    onStart(prompt);
  };

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          placeholder={t("composer.placeholder")}
          aria-label={t("composer.sendTask")}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button
            className="send send--stop"
            type="button"
            disabled={stopping}
            onClick={onStop}
            aria-label={stopping ? t("composer.stopping") : t("composer.stop")}
            title={stopping ? t("composer.stopping") : t("composer.stop")}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
        ) : (
          <button className="send" type="submit" disabled={!input.trim()} aria-label={t("composer.send")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
