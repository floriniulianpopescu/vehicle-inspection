import { MessageSquareIcon, PartyPopperIcon } from "lucide-react";
import { HistoryTab } from "@/components/sms/history-tab";
import { PendingTab } from "@/components/sms/pending-tab";
import { TemplatesTab } from "@/components/sms/templates-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

export function AutoSmsPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <Tabs defaultValue="reminders">
        <TabsList>
          <TabsTrigger value="reminders">
            <MessageSquareIcon />
            {t.sms.tabs.reminders}
          </TabsTrigger>
          <TabsTrigger value="greetings">
            <PartyPopperIcon />
            {t.sms.tabs.greetings}
          </TabsTrigger>
          <TabsTrigger value="history">{t.sms.tabs.history}</TabsTrigger>
          <TabsTrigger value="templates">{t.sms.tabs.templates}</TabsTrigger>
        </TabsList>
        <TabsContent value="reminders">
          <PendingTab channel="sms" />
        </TabsContent>
        <TabsContent value="greetings">
          <PendingTab channel="whatsapp" />
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
