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

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
