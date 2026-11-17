import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, type PickerOption } from "@/lib/api";
import { fill } from "@/lib/format";
import { formatPhone, isRomanianPhone, typingPhone } from "@/lib/romanian";
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
  compact = false,
}: {
  kind: "client" | "car";
  label: string;
  selected: PickerOption[];
  onChange: (selected: PickerOption[]) => void;
  multiple?: boolean;
  linkedTo?: number | null;
  /** Offers to add the typed phone number as a new client. */
  allowNewPhone?: boolean;
  /** A shorter list, two rows high. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  // The search the options were loaded for, so a complete number is matched against them.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const selectedKey = selected.map((option) => option.id).join();
  // Phones are stored without spaces, so "0722 123" is looked up as "0722123".
  const query = kind === "client" && /^[+\d\s\-().]+$/.test(search) ? phoneKey(search) : search;
  const show = (label: string) => (kind === "client" ? formatPhone(label) : label);

  useEffect(() => {
    let stale = false;
    const load = kind === "client" ? api.clientOptions : api.carOptions;
    load(query, linkedTo)
      .then((result) => {
        if (stale) return;
        setOptions(result);
        setLoadedFor(query);
      })
      .catch(() => {
        if (stale) return;
        setOptions([]);
        setLoadedFor(query);
      });
    return () => {
      stale = true;
    };
  }, [kind, query, linkedTo, selectedKey]);

  const isSelected = (id: number) => selected.some((option) => option.id === id);

  // A typed number that matches nothing listed or already chosen can be added.
  const typedKey = phoneKey(search);
  const canAdd =
    allowNewPhone &&
    typedKey.length >= 6 &&
    ![...options, ...selected].some((option) => phoneKey(option.label) === typedKey);

  function addTyped() {
    const option = { id: nextNewId--, label: formatPhone(search.trim()), linked: false };
    onChange(multiple ? [...selected, option] : [option]);
    setSearch("");
  }

  /**
   * A typed number is linked by itself: an existing client with that number is chosen, any
   * other number becomes a new client. Returns whether something was linked.
   */
  function linkTyped(): boolean {
    if (!allowNewPhone || typedKey.length < 6) return false;
    const known = options.find((option) => phoneKey(option.label) === typedKey);
    if (known) {
      if (!isSelected(known.id)) toggle(known);
      setSearch("");
      return true;
    }
    if (canAdd) {
      addTyped();
      return true;
    }
    return false;
  }

  // A complete Romanian number is linked as soon as its matches have loaded.
  useEffect(() => {
    if (loadedFor === query && isRomanianPhone(search)) linkTyped();
    // linkTyped reads the current options and selection, which change with these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedFor, query, search]);

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
              {show(option.label)}
              {isNewOption(option) && <span className="opacity-70">({t.data.newClientBadge})</span>}
              {isNewOption(option) && !isRomanianPhone(option.label) && (
                <span className="text-amber-700 dark:text-amber-400" title={t.data.phoneWarning}>
                  ⚠
                </span>
              )}
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
        onChange={(event) =>
          setSearch(kind === "client" ? typingPhone(event.target.value) : event.target.value)
        }
        onKeyDown={(event) => {
          // Enter links the typed number instead of submitting the whole form.
          if (event.key === "Enter" && linkTyped()) event.preventDefault();
        }}
        // Leaving the field links a number typed in another format (from abroad, say).
        onBlur={() => linkTyped()}
      />
      <div className={`${compact ? "h-16" : "h-28"} overflow-y-auto rounded-md border p-1`}>
        {canAdd && (
          <button
            type="button"
            // Keeps the typing field focused, so leaving it does not link the number twice.
            onMouseDown={(event) => event.preventDefault()}
            onClick={addTyped}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted"
          >
            <PlusIcon className="size-4" />
            <span className="flex flex-col">
              {fill(t.data.addPhone, { phone: formatPhone(search.trim()) })}
              {!isRomanianPhone(search) && (
                <span className="text-xs font-normal text-amber-700 dark:text-amber-400">
                  {t.data.phoneWarning}
                </span>
              )}
            </span>
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
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggle(option)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
          >
            <CheckIcon className={isSelected(option.id) ? "size-4" : "invisible size-4"} />
            <span className="flex-1 truncate">{show(option.label)}</span>
            {option.linked && <Badge variant="outline">{t.data.linked}</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}
