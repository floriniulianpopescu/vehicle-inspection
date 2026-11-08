import type { Page } from "@/components/app-nav";
import { useI18n } from "@/lib/i18n";

export function PlaceholderPage({ page }: { page: Page }) {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="font-heading text-xl font-semibold">{t.nav[page]}</h1>
      <p className="mt-2 text-muted-foreground">{t.placeholder}</p>
    </div>
  );
}
