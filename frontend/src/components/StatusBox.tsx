import type { ReactNode, RefObject } from "react";
import styles from "./ui.module.css";

export type StatusTone = "ok" | "warn" | "error" | "muted";

const TONE_CLASS: Record<StatusTone, string | undefined> = {
  ok: styles.statusOk,
  warn: styles.statusWarn,
  error: styles.statusError,
  muted: styles.statusMuted,
};

// role="alert" for errors, role="status" for the rest, so screen readers hear the change.
export function StatusBox({
  tone,
  title,
  children,
  id,
  headingRef,
}: {
  tone: StatusTone;
  title?: string;
  children?: ReactNode;
  id?: string;
  headingRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div
      id={id}
      className={`${styles.statusBox} ${TONE_CLASS[tone] ?? ""}`}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={tone === "error" ? -1 : undefined}
      ref={headingRef}
    >
      {title ? <div className={styles.statusTitle}>{title}</div> : null}
      {children}
    </div>
  );
}
