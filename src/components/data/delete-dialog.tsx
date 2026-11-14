import { useEffect, useState } from "react";
import { FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, type DeletePreview } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Lists everything a delete will remove and asks for confirmation. */
export function DeleteDialog({
  title,
  loadPreview,
  onConfirm,
  onClose,
  onDeleted,
}: {
  title: string;
  loadPreview: () => Promise<DeletePreview>;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPreview()
      .then(setPreview)
      .catch((failure) => setError(errorMessage(t, failure)));
    // The dialog is mounted for one record and loads its preview once.
  }, []);

  async function confirm() {
    try {
      await onConfirm();
      onDeleted();
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  const nothingListed = preview && !preview.cars.length && !preview.inspections && !preview.messages;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {nothingListed ? t.data.nothingElse : t.data.deleteWarning}
          </DialogDescription>
        </DialogHeader>
        {preview && !nothingListed && (
          <div className="flex max-h-64 flex-col gap-3 overflow-y-auto text-sm">
            {preview.cars.length > 0 && (
              <section>
                <h3 className="font-medium">
                  {t.data.cars} ({preview.cars.length})
                </h3>
                <ul>
                  {preview.cars.map((car) => (
                    <li key={car}>{car}</li>
                  ))}
                </ul>
              </section>
            )}
            {preview.inspections > 0 && (
              <section>
                <h3 className="font-medium">
                  {t.data.inspections} ({preview.inspections})
                </h3>
              </section>
            )}
            {preview.messages > 0 && (
              <section>
                <h3 className="font-medium">
                  {t.data.messages} ({preview.messages})
                </h3>
              </section>
            )}
          </div>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.data.cancel}
          </Button>
          <Button variant="destructive" disabled={!preview} onClick={confirm}>
            {t.data.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
