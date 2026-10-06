import type { ReactNode } from "react";
import styles from "./ui.module.css";

// Outer and inner borders of the framed card used throughout the design.
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.frame} ${className ?? ""}`}>
      <div className={styles.frameInner}>{children}</div>
    </div>
  );
}
