import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2Icon } from "lucide-react";
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
const GREETINGS = ["christmas", "new_year", "easter"];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The picture sent with a greeting: choose, replace or remove it. */
function GreetingImage({ template }: { template: SmsTemplate }) {
  const { t } = useI18n();
  const text = t.sms;
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(template.image ?? null);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t.data.errors.image_too_large);
      return;
    }
    try {
      const data = await readAsBase64(file);
      await api.smsSaveTemplateImage(template.kind, data, file.type);
      setImage(`data:${file.type};base64,${data}`);
      toast.success(text.imageSaved);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  async function remove() {
    setError(null);
    try {
      await api.smsRemoveTemplateImage(template.kind);
      setImage(null);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{text.image}</span>
      {image && (
        <img src={image} alt={text.image} className="max-h-40 w-fit rounded-md border object-contain" />
      )}
      <p className="text-xs text-muted-foreground">{text.imageHint}</p>
      <FormError message={error} />
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          <ImageIcon />
          {image ? text.replaceImage : text.chooseImage}
        </Button>
        {image && (
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            <Trash2Icon />
            {text.removeImage}
          </Button>
        )}
      </div>
    </div>
  );
}
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
        {template.kind === "feedback" && (
          <p className="text-xs text-muted-foreground">{text.placeholdersPlate}</p>
        )}
        <FormError message={error} />
        {GREETINGS.includes(template.kind) && <GreetingImage template={template} />}
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {/* Only SMS is billed by length; greetings go through WhatsApp. */}
            {template.kind === "inspection"
              ? `${text.smsOnly} ${fill(text.size, { characters: size.characters, parts: size.parts })}`
              : text.whatsappOnly}
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
