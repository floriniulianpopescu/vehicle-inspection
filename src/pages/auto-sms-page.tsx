import { MessageSquareIcon, PartyPopperIcon, ThumbsUpIcon } from "lucide-react";
import { HistoryTab } from "@/components/sms/history-tab";
import { PendingTab, usePendingMessages } from "@/components/sms/pending-tab";
import { TemplatesTab } from "@/components/sms/templates-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

// The message lists stay loaded while hidden, so switching between them is instant.
const KEEP = "data-[state=inactive]:hidden";

export function AutoSmsPage() {
  const { t } = useI18n();
  // Loaded once for the three message tabs.
  const shared = usePendingMessages();

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
          <TabsTrigger value="feedback">
            <ThumbsUpIcon />
            {t.sms.tabs.feedback}
          </TabsTrigger>
          <TabsTrigger value="history">{t.sms.tabs.history}</TabsTrigger>
          <TabsTrigger value="templates">{t.sms.tabs.templates}</TabsTrigger>
        </TabsList>
        <TabsContent value="reminders" forceMount className={KEEP}>
          <PendingTab group="reminders" shared={shared} />
        </TabsContent>
        <TabsContent value="greetings" forceMount className={KEEP}>
          <PendingTab group="greetings" shared={shared} />
        </TabsContent>
        <TabsContent value="feedback" forceMount className={KEEP}>
          <PendingTab group="feedback" shared={shared} />
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
