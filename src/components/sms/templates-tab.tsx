import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, type SmsTemplate } from "@/lib/api";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { smsSize } from "@/lib/sms";

const SAMPLE_PLATE = "B123ABC";
const SAMPLE_DATE = "01.01.2030";

function TemplateEditor({ template }: { template: SmsTemplate }) {
  const { t } = useI18n();
  const text = t.sms;
  const [saved, setSaved] = useState(template.text);
  const [value, setValue] = useState(template.text);
  const [error, setError] = useState<string | null>(null);
  const sample = value.replace(/\{plate\}/g, SAMPLE_PLATE).replace(/\{date\}/g, SAMPLE_DATE);
  const size = smsSize(sample);

  async function save() {
    setError(null);
    try {
      await api.smsSaveTemplate({ kind: template.kind, text: value });
      setSaved(value.trim());
      setValue(value.trim());
      toast.success(text.templateSaved);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.kinds[template.kind]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Textarea
          aria-label={text.kinds[template.kind]}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {template.kind === "inspection" && (
          <p className="text-xs text-muted-foreground">{text.placeholders}</p>
        )}
        <FormError message={error} />
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {fill(text.size, { characters: size.characters, parts: size.parts })}
          </span>
          <Button size="sm" disabled={value.trim() === saved} onClick={save}>
            {t.data.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TemplatesTab() {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .smsTemplates()
      .then(setTemplates)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t.sms.diacriticsHint}</p>
      <FormError message={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <TemplateEditor key={template.kind} template={template} />
        ))}
      </div>
    </div>
  );
}
