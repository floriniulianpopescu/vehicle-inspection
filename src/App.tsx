import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { AppNav, type Page } from "@/components/app-nav";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AboutPage } from "@/pages/about-page";
import { AutoSmsPage } from "@/pages/auto-sms-page";
import { DataPage } from "@/pages/data-page";
import { ReportsPage } from "@/pages/reports-page";
import { SettingsPage } from "@/pages/settings-page";

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("data");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const stop = listen("backup-closing", () => setClosing(true));
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  // Backups run as the app closes, so a failure can only be reported on the next start.
  useEffect(() => {
    api
      .backupStatus()
      .then((status) => {
        if (status.lastError) {
          toast.warning(t.settings.backup.lastFailedToast, { id: "backup-failed" });
        }
      })
      .catch(() => {});
    // Only once per start, not again when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="aero-backdrop flex h-screen flex-col text-foreground">
      <AppNav page={page} onNavigate={setPage} />
      <main className="min-h-0 flex-1 overflow-auto">
        {page === "data" ? (
          <DataPage />
        ) : page === "reports" ? (
          <ReportsPage />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : page === "about" ? (
          <AboutPage />
        ) : (
          <AutoSmsPage />
        )}
      </main>
      {closing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background/90">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="font-medium">{t.settings.backup.closing}</p>
          <p className="text-sm text-muted-foreground">{t.settings.backup.closingHint}</p>
        </div>
      )}
    </div>
  );
}
