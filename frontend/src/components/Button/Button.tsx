import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  /** Announced while loading; the visible label stays so the width does not jump. */
  loadingLabel?: string;
  block?: boolean;
  /** Square, sized to the touch target; needs an aria-label. */
  icon?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  loading = false,
  loadingLabel,
  block = false,
  icon = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], block && styles.block, icon && styles.icon, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
    >
      <span className={styles.label}>{children}</span>
      {loading && (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          {loadingLabel && <span className="visually-hidden">{loadingLabel}</span>}
        </>
      )}
    </button>
  );
}
