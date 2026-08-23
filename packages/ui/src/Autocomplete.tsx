import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

export interface AutocompleteOption {
  readonly id: string;
  readonly label: string;
}

interface AutocompleteProps {
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly onSelect: (option: AutocompleteOption) => void;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly AutocompleteOption[];
  readonly placeholder?: string;
  readonly renderOption?: (option: AutocompleteOption) => ReactNode;
  readonly required?: boolean;
  readonly value: string;
}

export function Autocomplete({
  ariaLabel,
  disabled = false,
  id: idProp,
  onSelect,
  onValueChange,
  options,
  placeholder,
  renderOption,
  required = false,
  value,
}: AutocompleteProps) {
  const fallbackId = useId();
  const id = idProp ?? fallbackId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);
  const maxIndex = options.length - 1;
  const activeIndexSafe = activeIndex < 0 ? -1 : Math.min(activeIndex, maxIndex);
  const active = activeIndexSafe >= 0 ? options[activeIndexSafe] : undefined;
  const listOpen = open && options.length > 0;

  useEffect(() => {
    if (!listOpen) return;
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndexSafe, listOpen]);

  function choose(option: AutocompleteOption): void {
    setOpen(false);
    setActiveIndex(-1);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!listOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (options.length === 0) return;
        event.preventDefault();
        setOpen(true);
        setActiveIndex(event.key === "ArrowDown" ? 0 : maxIndex);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((current) => (current < 0 ? 0 : Math.min(current + 1, maxIndex)));
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      case "Home": {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      case "End": {
        event.preventDefault();
        setActiveIndex(maxIndex);
        return;
      }
      case "Enter": {
        if (active) {
          event.preventDefault();
          choose(active);
        }
        return;
      }
      case "Escape": {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  return (
    <span className="autocomplete">
      <input
        aria-activedescendant={
          listOpen && activeIndexSafe >= 0
            ? `${listboxId}-option-${String(activeIndexSafe)}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={listOpen}
        aria-label={ariaLabel}
        autoComplete="off"
        className="autocomplete__input"
        disabled={disabled}
        id={id}
        onBlur={() => {
          setOpen(false);
        }}
        onChange={(event) => {
          const next = event.target.value;
          onValueChange(next);
          setOpen(true);
          setActiveIndex(next.trim() ? 0 : -1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        role="combobox"
        type="text"
        value={value}
      />
      {listOpen ? (
        <ul
          className="autocomplete__listbox"
          id={listboxId}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          role="listbox"
        >
          {options.map((option, index) => (
            <li
              aria-selected={index === activeIndexSafe}
              className="autocomplete__option"
              id={`${listboxId}-option-${String(index)}`}
              key={option.id}
              ref={index === activeIndexSafe ? activeOptionRef : undefined}
              onClick={() => {
                choose(option);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              role="option"
            >
              {renderOption ? renderOption(option) : option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
