import { useId, useLayoutEffect, useRef } from 'react';
import styles from './NumberField.module.css';
import { parseWholeNumber } from './parseWholeNumber';

export interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Shown inside the field after the number, e.g. "lb". */
  unit?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Digits left of `pos`, so the caret can be put back after separators move. */
function digitsBefore(text: string, pos: number): number {
  return text.slice(0, pos).replace(/\D/g, '').length;
}

function caretAfterDigits(text: string, digits: number): number {
  if (digits === 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i]) && ++seen === digits) return i + 1;
  }
  return text.length;
}

/**
 * Whole numbers with live thousands separators. A text input with inputMode="numeric" rather
 * than type="number", which cannot show separators and quietly accepts "e" and wheel scrolls.
 */
export function NumberField({ label, value, onChange, unit, placeholder, hint, error }: NumberFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const display = value === null ? '' : grouped.format(value);

  // Reformatting moves the caret to the end; put it back after the same digit.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && pendingCaret.current !== null && document.activeElement === input) {
      const pos = caretAfterDigits(display, pendingCaret.current);
      input.setSelectionRange(pos, pos);
    }
    pendingCaret.current = null;
  }, [display]);

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <input
          ref={inputRef}
          id={id}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          value={display}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            pendingCaret.current = digitsBefore(raw, e.target.selectionStart ?? raw.length);
            onChange(parseWholeNumber(raw));
          }}
        />
        {unit && (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {message && (
        <p id={messageId} className={error ? styles.error : styles.hint}>
          {message}
        </p>
      )}
    </div>
  );
}
