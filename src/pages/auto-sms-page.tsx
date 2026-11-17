import { MessageCircleIcon, MessageSquareIcon, PartyPopperIcon, ThumbsUpIcon } from "lucide-react";
import { HistoryTab } from "@/components/sms/history-tab";
import { PendingTab, usePendingMessages } from "@/components/sms/pending-tab";
import { TemplatesTab } from "@/components/sms/templates-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";

// The message lists stay loaded while hidden, so switching between them is instant.
const KEEP = "data-[state=inactive]:hidden";

export function AutoSmsPage() {
  const { t } = useI18n();
  // Loaded once for the three message tabs.
  const shared = usePendingMessages();
  // Reminders WhatsApp could not deliver, still to go by SMS.
  const smsToSend = shared.all.filter(
    (item) =>
      item.kind === "inspection" &&
      item.channel === "sms" &&
      item.status !== "sent" &&
      item.otherStatus === "failed",
  ).length;
  const failedReminders = shared.all.filter(
    (item) => item.kind === "inspection" && item.channel === "whatsapp" && item.status === "failed",
  ).length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <Tabs defaultValue="remindersWhatsapp">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="remindersWhatsapp">
            <MessageCircleIcon />
            {t.sms.tabs.remindersWhatsapp}
            {failedReminders > 0 && <Badge variant="destructive">{failedReminders}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="remindersSms">
            <MessageSquareIcon />
            {t.sms.tabs.remindersSms}
            {smsToSend > 0 && <Badge variant="secondary">{smsToSend}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="greetings">
            <PartyPopperIcon />
            {t.sms.tabs.greetings}
          </TabsTrigger>
          <TabsTrigger value="feedback">
            <ThumbsUpIcon />
            {t.sms.tabs.feedback}
          </TabsTrigger>
          <TabsTrigger value="historyWhatsapp">{t.sms.tabs.historyWhatsapp}</TabsTrigger>
          <TabsTrigger value="historySms">{t.sms.tabs.historySms}</TabsTrigger>
          <TabsTrigger value="templates">{t.sms.tabs.templates}</TabsTrigger>
        </TabsList>
        <TabsContent value="remindersWhatsapp" forceMount className={KEEP}>
          <PendingTab group="remindersWhatsapp" shared={shared} />
        </TabsContent>
        <TabsContent value="remindersSms" forceMount className={KEEP}>
          <PendingTab group="remindersSms" shared={shared} />
        </TabsContent>
        <TabsContent value="greetings" forceMount className={KEEP}>
          <PendingTab group="greetings" shared={shared} />
        </TabsContent>
        <TabsContent value="feedback" forceMount className={KEEP}>
          <PendingTab group="feedback" shared={shared} />
        </TabsContent>
        <TabsContent value="historyWhatsapp">
          <HistoryTab channel="whatsapp" />
        </TabsContent>
        <TabsContent value="historySms">
          <HistoryTab channel="sms" />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
