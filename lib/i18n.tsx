"use client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

export type Locale = "zh-CN" | "en";
export type SettingsTab = "general" | "hosts" | "agents" | "email" | "plugins";

const STORAGE_KEY = "scope:locale";
const LOCALE_EVENT = "scope:locale-change";
let fallbackLocale: Locale = "zh-CN";

function readLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* ignore storage errors */
  }
  return fallbackLocale;
}

function subscribeLocale(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(LOCALE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(LOCALE_EVENT, notify);
  };
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  tr: (zh: string, en: string) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "zh-CN",
  setLocale: () => {},
  toggleLocale: () => {},
  tr: (zh) => zh,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(
    subscribeLocale,
    readLocale,
    () => "zh-CN",
  );

  function setLocale(next: Locale) {
    fallbackLocale = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage errors */
    }
    window.dispatchEvent(new Event(LOCALE_EVENT));
  }

  function toggleLocale() {
    setLocale(locale === "zh-CN" ? "en" : "zh-CN");
  }

  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        toggleLocale,
        tr: (zh, en) => (locale === "en" ? en : zh),
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
