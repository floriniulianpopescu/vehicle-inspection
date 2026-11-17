import { useRef, useState } from "react";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The picture sent with a message: choose, replace or remove it. */
export function ImagePicker({
  image,
  onSave,
  onRemove,
}: {
  image: string | null;
  onSave: (data: string, mime: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useI18n();
  const text = t.sms;
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(image);
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
      await onSave(data, file.type);
      setShown(`data:${file.type};base64,${data}`);
      toast.success(text.imageSaved);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  async function remove() {
    setError(null);
    try {
      await onRemove();
      setShown(null);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{text.image}</span>
      {shown && <img src={shown} alt={text.image} className="max-h-40 w-fit rounded-md border object-contain" />}
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
          {shown ? text.replaceImage : text.chooseImage}
        </Button>
        {shown && (
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            <Trash2Icon />
            {text.removeImage}
          </Button>
        )}
      </div>
    </div>
  );
}
