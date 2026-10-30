"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { auth } from "@eazo/sdk";
import { useEazo } from "@eazo/sdk/react";

import { changeLocale, normalizeLocale, type LocaleCode } from "@/i18n";

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name || email || "?").trim();
  if (!base) return "?";
  const parts = base.split(/[\s@_./-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function Avatar({
  url,
  name,
  email,
  size = 28,
}: {
  url: string | null | undefined;
  name: string | null | undefined;
  email: string | null | undefined;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar URLs from Eazo
      <img
        className="user-menu__avatar"
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="user-menu__avatar user-menu__avatar--fallback" aria-hidden="true">
      {initials(name, email)}
    </span>
  );
}

/**
 * Sidebar footer: avatar + name + ⋮ menu (language / sign out).
 * Collapsed desktop rail (`.app--rail-collapsed`) hides the label via CSS
 * and leaves a tappable avatar that opens the same menu.
 */
export function UserMenu() {
  const { t, i18n } = useTranslation();
  const authState = useEazo((s) => s.auth);
  const locale = (normalizeLocale(i18n.resolvedLanguage || i18n.language) ?? "en") as LocaleCode;
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setLangOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setLangOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setLangOpen(false);
  }, [open]);

  if (authState.loading) {
    return (
      <div className="user-menu">
        <div className="user-menu__row user-menu__row--ghost">
          <span className="user-menu__avatar user-menu__avatar--fallback" aria-hidden="true">
            …
          </span>
        </div>
      </div>
    );
  }

  if (!authState.authenticated) {
    return (
      <div className="user-menu">
        <button
          type="button"
          className="user-menu__signin"
          title={t("auth.signInWithEazo")}
          onClick={() => auth.login().catch(() => {})}
        >
          <span className="user-menu__avatar user-menu__avatar--fallback" aria-hidden="true">
            →
          </span>
          <span className="user-menu__signin-label">{t("auth.signInWithEazo")}</span>
        </button>
      </div>
    );
  }

  const user = authState.user;
  const displayName = user?.name || user?.email || t("auth.signedIn");

  const openMenu = () => setOpen((v) => !v);

  return (
    <div className={`user-menu${open ? " user-menu--open" : ""}`} ref={rootRef}>
      <div className="user-menu__row">
        <button
          type="button"
          className="user-menu__identity"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="menu"
          title={displayName}
          onClick={openMenu}
        >
          <Avatar url={user?.avatarUrl} name={user?.name} email={user?.email} />
          <span className="user-menu__meta">
            <span className="user-menu__name">{displayName}</span>
            {user?.email && user?.name ? <span className="user-menu__email">{user.email}</span> : null}
          </span>
        </button>
        <button
          type="button"
          className="user-menu__more"
          aria-label={t("userMenu.open")}
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="menu"
          onClick={openMenu}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="user-menu__popover" id={menuId} role="menu">
          <div className="user-menu__popover-head">
            <Avatar url={user?.avatarUrl} name={user?.name} email={user?.email} size={36} />
            <div className="user-menu__popover-meta">
              <div className="user-menu__popover-name">{displayName}</div>
              {user?.email ? <div className="user-menu__popover-email">{user.email}</div> : null}
            </div>
          </div>

          <div className="user-menu__sep" />

          <button
            type="button"
            className="user-menu__item"
            role="menuitem"
            aria-expanded={langOpen}
            onClick={() => setLangOpen((v) => !v)}
          >
            <span className="user-menu__item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
              </svg>
            </span>
            <span className="user-menu__item-label">{t("lang.label")}</span>
            <span className="user-menu__item-trail">
              {locale === "zh" ? "中文" : "EN"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={langOpen ? "m6 14 6-6 6 6" : "m9 6 6 6-6 6"} />
              </svg>
            </span>
          </button>

          {langOpen && (
            <div className="user-menu__submenu" role="group" aria-label={t("lang.label")}>
              {(["en", "zh"] as LocaleCode[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={locale === code}
                  className={`user-menu__item user-menu__item--sub${locale === code ? " user-menu__item--on" : ""}`}
                  onClick={() => {
                    void changeLocale(code);
                    setOpen(false);
                    setLangOpen(false);
                  }}
                >
                  <span className="user-menu__item-label">
                    {code === "en" ? t("lang.switchToEn") : t("lang.switchToZh")}
                  </span>
                  {locale === code ? (
                    <span className="user-menu__check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          <div className="user-menu__sep" />

          <button
            type="button"
            className="user-menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              auth.logout();
            }}
          >
            <span className="user-menu__item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1" />
                <path d="M15 12H3m0 0 3-3m-3 3 3 3" />
              </svg>
            </span>
            <span className="user-menu__item-label">{t("auth.signOut")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
