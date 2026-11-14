import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** A form control under its label. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex-col items-stretch gap-1.5">
      {label}
      {children}
    </Label>
  );
}

/** A small yellow note that does not stop saving, e.g. a plate in an unusual format. */
export function FormWarning({ message }: { message: string | null | false }) {
  if (!message) return null;
  return (
    <span role="status" className="text-xs font-normal text-amber-700 dark:text-amber-400">
      {message}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
