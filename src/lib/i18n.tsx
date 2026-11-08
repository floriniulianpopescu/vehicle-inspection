import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { en } from "@/locales/en";
import { ro, type Messages } from "@/locales/ro";

export type Language = "ro" | "en";

const STORAGE_KEY = "language";
const messages: Record<Language, Messages> = { ro, en };

function storedLanguage(): Language {
  return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ro";
}

type I18n = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Messages;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(storedLanguage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t: messages[language] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
