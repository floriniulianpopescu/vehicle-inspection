import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "next-themes";
import { BackupCard } from "@/components/backup/backup-card";
import { GatewayCard } from "@/components/sms/gateway-card";
import { CalendarSettingsCard } from "@/components/calendar-settings-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n, type Language } from "@/lib/i18n";

const THEMES = ["light", "dark", "system"] as const;

type DatabaseInfo = {
  path: string;
  schemaVersion: number;
};

export function SettingsPage() {
  const { t, language, setLanguage } = useI18n();
  const { theme = "system", setTheme } = useTheme();
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [databaseFailed, setDatabaseFailed] = useState(false);

  useEffect(() => {
    invoke<DatabaseInfo>("database_info")
      .then(setDatabase)
      .catch(() => setDatabaseFailed(true));
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="font-heading text-xl font-semibold">{t.nav.settings}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.appearance}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="theme">{t.settings.theme}</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger id="theme" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t.settings.themes[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="language">{t.settings.language}</Label>
            <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
              <SelectTrigger id="language" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ro">Română</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <CalendarSettingsCard />

      <BackupCard />

      <GatewayCard />

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.database}</CardTitle>
        </CardHeader>
        <CardContent>
          {database ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">{t.settings.location}</dt>
              <dd className="break-all">{database.path}</dd>
              <dt className="text-muted-foreground">{t.settings.schemaVersion}</dt>
              <dd>{database.schemaVersion}</dd>
            </dl>
          ) : databaseFailed ? (
            <p className="text-muted-foreground">{t.settings.databaseUnavailable}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
