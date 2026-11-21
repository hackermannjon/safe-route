import { useId, type ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string | number> {
  label: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  error?: string;
}

/** Native radios underneath, so arrow keys, form semantics and screen readers come for free. */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  error,
}: SegmentedControlProps<T>) {
  const name = useId();
  const errorId = `${name}-error`;

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.track} data-invalid={error ? true : undefined}>
        {options.map((option) => (
          <label key={String(option.value)} className={styles.segment}>
            <input
              type="radio"
              name={name}
              className={styles.input}
              value={String(option.value)}
              checked={option.value === value}
              aria-describedby={error ? errorId : undefined}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.text}>
              {option.icon}
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
