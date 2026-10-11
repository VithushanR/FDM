import type { ExplainState } from "../state/assessStore";
import { ExplainFactors } from "./ExplainFactors";
import { Frame } from "./Frame";
import styles from "./result.module.css";
import ui from "./ui.module.css";

export function ExplainCard({ explain }: { explain: ExplainState }) {
  return (
    <Frame className={styles.explainCard}>
      <div className={styles.explainCardBody}>
        <h2 className={ui.cardTitle}>What pushed this estimate</h2>
        <div style={{ marginTop: 12 }}>
          <ExplainFactors explain={explain} variant="card" />
        </div>
      </div>
    </Frame>
  );
}
