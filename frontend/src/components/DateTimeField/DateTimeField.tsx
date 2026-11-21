import { useId } from 'react';
import styles from './DateTimeField.module.css';

export interface DateTimeFieldProps {
  label: string;
  /** `YYYY-MM-DDTHH:mm` in the browser's zone. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** Short helper line under the input, e.g. which time zone the value is in. */
  hint?: string;
  error?: string;
}

export function DateTimeField({ label, value, onChange, min, max, hint, error }: DateTimeFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="datetime-local"
        value={value}
        min={min}
        max={max}
        step={60}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {message && (
        <p id={messageId} className={error ? styles.error : styles.hint}>
          {message}
        </p>
      )}
    </div>
  );
}
