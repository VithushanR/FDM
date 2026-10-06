import type { ReactNode } from "react";
import styles from "./ui.module.css";

export interface ControlA11y {
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  helper?: string;
  span: number;
  children: (a11y: ControlA11y) => ReactNode;
}

// Label above the control. The control gets aria-invalid and aria-describedby from here.
export function Field({ id, label, error, helper, span, children }: FieldProps) {
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-help` : null].filter(Boolean).join(" ");
  return (
    <div className={styles.field} style={{ gridColumn: `span ${span}` }} data-field={id}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({ "aria-invalid": Boolean(error), "aria-describedby": describedBy || undefined })}
      {helper ? (
        <span id={`${id}-help`} className={styles.helper}>
          {helper}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className={styles.errorText}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
