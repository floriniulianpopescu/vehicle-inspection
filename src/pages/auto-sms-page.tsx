import { HistoryTab } from "@/components/sms/history-tab";
import { PendingTab } from "@/components/sms/pending-tab";
import { TemplatesTab } from "@/components/sms/templates-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

export function AutoSmsPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">{t.sms.tabs.pending}</TabsTrigger>
          <TabsTrigger value="history">{t.sms.tabs.history}</TabsTrigger>
          <TabsTrigger value="templates">{t.sms.tabs.templates}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <PendingTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
