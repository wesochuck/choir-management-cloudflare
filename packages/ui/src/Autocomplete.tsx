import type { KeyboardEvent, ReactNode } from "react";
import { useId, useState } from "react";

export interface AutocompleteOption {
  readonly id: string;
  readonly label: string;
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
}: {
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
}) {
  const fallbackId = useId();
  const id = idProp ?? fallbackId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listOpen = open && options.length > 0;

  function choose(option: AutocompleteOption): void {
    setOpen(false);
    setActiveIndex(-1);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!listOpen) return;
    const active = activeIndex >= 0 ? options[activeIndex] : undefined;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((current) => (current < 0 ? 0 : Math.min(current + 1, options.length - 1)));
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
        setActiveIndex(options.length - 1);
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
          listOpen && activeIndex >= 0 ? `${listboxId}-option-${String(activeIndex)}` : undefined
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
              aria-selected={index === activeIndex}
              className="autocomplete__option"
              id={`${listboxId}-option-${String(index)}`}
              key={option.id}
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
