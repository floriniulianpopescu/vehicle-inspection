import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, type PickerOption } from "@/lib/api";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** Digits only, in national form, so "+40 722..." and "0722..." compare equal. */
export function phoneKey(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits.startsWith("0040")) return `0${digits.slice(4)}`;
  if (digits.startsWith("40") && text.trim().startsWith("+")) return `0${digits.slice(2)}`;
  return digits;
}

/** Typed numbers not saved yet get negative ids until the form is saved. */
let nextNewId = -1;

export function isNewOption(option: PickerOption): boolean {
  return option.id < 0;
}

/** Searchable list of clients or cars, choosing one or several. */
export function EntityPicker({
  kind,
  label,
  selected,
  onChange,
  multiple = false,
  linkedTo = null,
  allowNewPhone = false,
}: {
  kind: "client" | "car";
  label: string;
  selected: PickerOption[];
  onChange: (selected: PickerOption[]) => void;
  multiple?: boolean;
  linkedTo?: number | null;
  /** Offers to add the typed phone number as a new client. */
  allowNewPhone?: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const selectedKey = selected.map((option) => option.id).join();

  useEffect(() => {
    let stale = false;
    const load = kind === "client" ? api.clientOptions : api.carOptions;
    load(search, linkedTo)
      .then((result) => {
        if (!stale) setOptions(result);
      })
      .catch(() => {
        if (!stale) setOptions([]);
      });
    return () => {
      stale = true;
    };
  }, [kind, search, linkedTo, selectedKey]);

  const isSelected = (id: number) => selected.some((option) => option.id === id);

  // A typed number that matches nothing listed or already chosen can be added.
  const typedKey = phoneKey(search);
  const canAdd =
    allowNewPhone &&
    typedKey.length >= 6 &&
    ![...options, ...selected].some((option) => phoneKey(option.label) === typedKey);

  function addTyped() {
    const option = { id: nextNewId--, label: search.trim(), linked: false };
    onChange(multiple ? [...selected, option] : [option]);
    setSearch("");
  }

  function toggle(option: PickerOption) {
    if (!multiple) onChange([option]);
    else if (isSelected(option.id)) onChange(selected.filter((item) => item.id !== option.id));
    else onChange([...selected, option]);
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm leading-none font-medium">{label}</span>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((option) => (
            <Badge key={option.id} variant="secondary">
              {option.label}
              {isNewOption(option) && <span className="opacity-70">({t.data.newClientBadge})</span>}
              {multiple && (
                <button
                  type="button"
                  aria-label={`${t.data.delete} ${option.label}`}
                  onClick={() => toggle(option)}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={search}
        placeholder={t.data.searchOptions}
        aria-label={`${label}: ${t.data.searchOptions}`}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          // Enter adds the typed number instead of submitting the whole form.
          if (event.key === "Enter" && canAdd) {
            event.preventDefault();
            addTyped();
          }
        }}
      />
      <div className="h-28 overflow-y-auto rounded-md border p-1">
        {canAdd && (
          <button
            type="button"
            onClick={addTyped}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted"
          >
            <PlusIcon className="size-4" />
            {fill(t.data.addPhone, { phone: search.trim() })}
          </button>
        )}
        {options.length === 0 && !canAdd && (
          <p className="p-2 text-sm text-muted-foreground">{t.data.noOptions}</p>
        )}
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={isSelected(option.id)}
            onClick={() => toggle(option)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
          >
            <CheckIcon className={isSelected(option.id) ? "size-4" : "invisible size-4"} />
            <span className="flex-1 truncate">{option.label}</span>
            {option.linked && <Badge variant="outline">{t.data.linked}</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}
