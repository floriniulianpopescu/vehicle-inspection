import { useEffect, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, type PickerOption } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Searchable list of clients or cars, choosing one or several. */
export function EntityPicker({
  kind,
  label,
  selected,
  onChange,
  multiple = false,
  linkedTo = null,
}: {
  kind: "client" | "car";
  label: string;
  selected: PickerOption[];
  onChange: (selected: PickerOption[]) => void;
  multiple?: boolean;
  linkedTo?: number | null;
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
      />
      <div className="h-28 overflow-y-auto rounded-md border p-1">
        {options.length === 0 && (
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
