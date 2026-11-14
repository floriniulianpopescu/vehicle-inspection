import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Suggestion = { key: string; label: string; hint?: string };

/**
 * A text field that lists suggestions while typing. Arrow keys move through them, Enter or a
 * click picks one, Escape closes the list. Typing anything else is still allowed.
 */
export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  onPick,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  onPick: (suggestion: Suggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = open && suggestions.length > 0;

  function pick(suggestion: Suggestion) {
    onPick(suggestion);
    setOpen(false);
  }

  return (
    <Popover open={shown} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={shown}
          aria-autocomplete="list"
          onChange={(event) => {
            onChange(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (!shown) {
              if (event.key === "ArrowDown") setOpen(true);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((current) => (current + step + suggestions.length) % suggestions.length);
            } else if (event.key === "Enter" || event.key === "Tab") {
              // Enter picks instead of submitting the form; Tab picks and moves on.
              if (event.key === "Enter") event.preventDefault();
              pick(suggestions[Math.min(active, suggestions.length - 1)]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-48 p-1"
        // Keep typing in the field while the list is open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ul role="listbox" className="flex flex-col">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.key}
              role="option"
              aria-selected={index === active}
              // Picking with the mouse must not blur the field first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(suggestion)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex cursor-default items-center justify-between gap-3 rounded-sm px-2 py-1 text-sm",
                index === active && "bg-primary/15",
              )}
            >
              <span>{suggestion.label}</span>
              {suggestion.hint && <span className="text-xs text-muted-foreground">{suggestion.hint}</span>}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
