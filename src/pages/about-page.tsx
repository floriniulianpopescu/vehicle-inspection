import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

const STACK = "Tauri, Rust, React, TypeScript, Tailwind CSS, shadcn/ui, SQLite";

export function AboutPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.appName}</CardTitle>
          <CardDescription>{t.about.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">{t.about.author}</dt>
            <dd>Florin-Iulian Popescu</dd>
            <dt className="text-muted-foreground">{t.about.builtWith}</dt>
            <dd>{STACK}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
