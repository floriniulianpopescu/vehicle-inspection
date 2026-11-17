import { useState, type ReactNode } from "react";
import { HeartIcon, HistoryIcon, MessageSquareIcon, PenLineIcon, ThumbsUpIcon, TypeIcon } from "lucide-react";
import { CustomTab } from "@/components/sms/custom-tab";
import { HistoryTab } from "@/components/sms/history-tab";
import { PendingTab, usePendingMessages } from "@/components/sms/pending-tab";
import { TemplatesTab } from "@/components/sms/templates-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

// The message lists stay loaded while hidden, so switching between them is instant.
const KEEP = "data-[state=inactive]:hidden";

type Channel = "whatsapp" | "sms";

/** WhatsApp or SMS, for the tabs that hold both. */
function ChannelSwitch({
  value,
  onChange,
  badges = {},
}: {
  value: Channel;
  onChange: (channel: Channel) => void;
  badges?: Partial<Record<Channel, ReactNode>>;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.sms.channel} className="flex gap-1">
      {(["whatsapp", "sms"] as const).map((channel) => (
        <Button
          key={channel}
          role="radio"
          aria-checked={value === channel}
          variant={value === channel ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(channel)}
        >
          {t.sms.channels[channel]}
          {badges[channel]}
        </Button>
      ))}
    </div>
  );
}

export function AutoSmsPage() {
  const { t } = useI18n();
  const text = t.sms;
  // Loaded once for all the message tabs.
  const shared = usePendingMessages();
  const [reminderChannel, setReminderChannel] = useState<Channel>("whatsapp");
  const [historyChannel, setHistoryChannel] = useState<Channel>("whatsapp");
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
  const count = (value: number, variant: "secondary" | "destructive") =>
    value > 0 ? <Badge variant={variant}>{value}</Badge> : null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <Tabs defaultValue="reminders">
        <TabsList className="h-auto max-w-full flex-wrap">
          <TabsTrigger value="reminders">
            <MessageSquareIcon />
            {text.tabs.reminders}
            {count(failedReminders + smsToSend, "destructive")}
          </TabsTrigger>
          <TabsTrigger value="custom" title={text.whatsappOnlyTab}>
            <PenLineIcon />
            {text.tabs.custom}
          </TabsTrigger>
          <TabsTrigger value="feedback" title={text.whatsappOnlyTab}>
            <ThumbsUpIcon />
            {text.tabs.feedback}
          </TabsTrigger>
          <TabsTrigger value="thanks" title={text.whatsappOnlyTab}>
            <HeartIcon />
            {text.tabs.thanks}
          </TabsTrigger>
          <TabsTrigger value="history">
            <HistoryIcon />
            {text.tabs.history}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <TypeIcon />
            {text.tabs.templates}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reminders" forceMount className={`${KEEP} flex flex-col gap-3`}>
          <ChannelSwitch
            value={reminderChannel}
            onChange={setReminderChannel}
            badges={{ whatsapp: count(failedReminders, "destructive"), sms: count(smsToSend, "secondary") }}
          />
          <div className={reminderChannel === "whatsapp" ? "" : "hidden"}>
            <PendingTab group="remindersWhatsapp" shared={shared} />
          </div>
          <div className={reminderChannel === "sms" ? "" : "hidden"}>
            <PendingTab group="remindersSms" shared={shared} />
          </div>
        </TabsContent>
        <TabsContent value="custom" forceMount className={KEEP}>
          <CustomTab shared={shared} />
        </TabsContent>
        <TabsContent value="feedback" forceMount className={KEEP}>
          <PendingTab group="feedback" shared={shared} />
        </TabsContent>
        <TabsContent value="thanks" forceMount className={KEEP}>
          <PendingTab group="thanks" shared={shared} />
        </TabsContent>
        <TabsContent value="history" className="flex flex-col gap-3">
          <ChannelSwitch value={historyChannel} onChange={setHistoryChannel} />
          <HistoryTab key={historyChannel} channel={historyChannel} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
