import type { Hotspot } from "../api/endpoints";
import { hotspotLabel, SHOW_LABELS, type ShowKey, type ShowOption } from "../state/hotspotState";
import styles from "./hotspots.module.css";
import ui from "./ui.module.css";

interface Props {
  items: Hotspot[];
  inView: number;
  total: number;
  selectedId: number | null;
  show: ShowKey;
  options: ShowOption[];
  // The chosen option when it had no hotspots and another is shown instead, so the list can say why.
  emptied: ShowKey | null;
  viewText: string;
  onShow: (show: ShowKey) => void;
  onSelect: (id: number) => void;
  onShowMore: () => void;
  onExport: () => void;
  canExport: boolean;
  // True while a selection keeps the ranking from before the map zoomed in.
  kept: boolean;
}

const EMPTY_TEXT: Record<ShowKey, string> = {
  collisions: "No hotspots",
  fatal: "No hotspots with a fatal collision",
  severe: "No hotspots with a Fatal or Serious collision",
};

export function HotspotList(props: Props) {
  const { items, inView, total, selectedId, show, options, emptied, viewText, onShow, onSelect, onShowMore, onExport, canExport, kept } = props;
  return (
    <section aria-labelledby="top-heading">
      <h2 id="top-heading" className={ui.cardTitle} style={{ fontSize: 24 }}>
        Top in view
      </h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <label htmlFor="show-select" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>
          Show
        </label>
        <select
          id="show-select"
          className={styles.segment}
          style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--control-border)", borderRadius: 14, minHeight: 44 }}
          value={show}
          onChange={(event) => {
            onShow(event.target.value as ShowKey);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" className={ui.btnSecondary} style={{ whiteSpace: "nowrap" }} onClick={onExport} disabled={!canExport}>
          Export CSV
        </button>
      </div>

      {emptied ? (
        <p role="status" className={ui.muted} style={{ margin: "10px 0 0", fontSize: 14 }}>
          {`${EMPTY_TEXT[emptied]} in ${viewText} with these filters. Showing "${SHOW_LABELS[show]}" instead.`}
        </p>
      ) : null}

      {kept ? (
        <p className={ui.muted} style={{ margin: "10px 0 0", fontSize: 14 }}>
          This is the ranking from before you zoomed in, so you can go down the list. Clear the selection to rank the
          current view.
        </p>
      ) : null}

      <ol style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 8 }}>
        {items.map((hotspot, index) => {
          const selected = hotspot.id === selectedId;
          return (
            <li key={hotspot.id}>
              <button
                type="button"
                aria-pressed={selected}
                className={`${styles.row} ${selected ? styles.rowSelected : ""}`}
                onClick={() => {
                  onSelect(hotspot.id);
                }}
              >
                <span className={styles.rank} aria-hidden="true">
                  {index + 1}
                </span>
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontWeight: 700 }}>{hotspotLabel(hotspot)}</span>
                  <span style={{ fontSize: 14 }}>
                    {hotspot.collisions} collisions: {hotspot.fatal} Fatal, {hotspot.serious} Serious
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={ui.muted} style={{ fontSize: 14 }}>
          {kept
            ? `Showing ${items.length} of ${inView.toLocaleString("en-GB")}.`
            : `Showing ${items.length} of ${inView.toLocaleString("en-GB")} loaded. ${total.toLocaleString("en-GB")} hotspots match your filters.`}{" "}
          Click a row or a circle for its details.
        </span>
        {items.length < inView ? (
          <button type="button" className={ui.btnLink} onClick={onShowMore}>
            Show more
          </button>
        ) : null}
      </div>
    </section>
  );
}
