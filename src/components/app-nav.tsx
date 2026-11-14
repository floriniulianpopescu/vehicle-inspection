import {
  DatabaseIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  MessageSquareIcon,
  SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const items = [
  { page: "data", icon: DatabaseIcon },
  { page: "reports", icon: FileSpreadsheetIcon },
  { page: "autoSms", icon: MessageSquareIcon },
  { page: "settings", icon: SettingsIcon },
  { page: "about", icon: InfoIcon },
] as const;

export type Page = (typeof items)[number]["page"];

export function AppNav({
  page,
  onNavigate,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const { t } = useI18n();

  return (
    <header className="aero-bar relative z-10 flex h-14 shrink-0 items-center gap-4 border-b px-4">
      <span className="font-heading font-semibold whitespace-nowrap">{t.appName}</span>
      <nav className="flex items-center gap-1">
        {items.map(({ page: target, icon: Icon }) => (
          <Button
            key={target}
            variant={target === page ? "secondary" : "ghost"}
            aria-current={target === page ? "page" : undefined}
            onClick={() => onNavigate(target)}
          >
            <Icon />
            {t.nav[target]}
          </Button>
        ))}
      </nav>
    </header>
  );
}
