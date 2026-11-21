import { useId, useState, type KeyboardEvent } from 'react';
import type { GeocodeResult } from '../../types/api';
import styles from './PlaceField.module.css';

export interface PlaceFieldProps {
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: GeocodeResult[];
  onSelect: (result: GeocodeResult) => void;
  /** True once the text matches a picked suggestion. */
  resolved: boolean;
  searching?: boolean;
  searchFailed?: boolean;
  error?: string;
  placeholder?: string;
}

/** Text input with a suggestion list, following the ARIA combobox pattern. */
export function PlaceField({
  label,
  query,
  onQueryChange,
  suggestions,
  onSelect,
  resolved,
  searching = false,
  searchFailed = false,
  error,
  placeholder,
}: PlaceFieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const showList = open && !resolved && query.trim().length >= 2;
  const hasOptions = showList && suggestions.length > 0;
  const status = !showList
    ? ''
    : searching
      ? 'Searching…'
      : searchFailed
        ? "Place search isn't responding. Try again in a moment."
        : suggestions.length === 0
          ? `No places match “${query.trim()}”.`
          : '';

  const choose = (result: GeocodeResult) => {
    onSelect(result);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (suggestions.length) setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length) setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter' && hasOptions) {
      event.preventDefault();
      choose(suggestions[Math.max(active, 0)]);
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={hasOptions}
        aria-controls={listId}
        aria-activedescendant={hasOptions && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        className={styles.list}
        hidden={!showList || (!hasOptions && !status)}
      >
        {hasOptions &&
          suggestions.map((s, i) => (
            <li
              key={`${s.lat},${s.lon},${s.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // Keep focus in the input so the blur does not close the list before the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              {s.label}
            </li>
          ))}
        {!hasOptions && status && (
          <li className={styles.status} role="presentation">
            {status}
          </li>
        )}
      </ul>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
