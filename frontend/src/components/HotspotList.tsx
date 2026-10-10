import type { Hotspot } from "../api/endpoints";
import { hotspotLabel, type SortKey } from "../state/hotspotState";
import styles from "./hotspots.module.css";
import ui from "./ui.module.css";

interface Props {
  items: Hotspot[];
  inView: number;
  total: number;
  selectedId: number | null;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  onSelect: (id: number) => void;
  onShowMore: () => void;
  onExport: () => void;
  canExport: boolean;
  // True while a selection keeps the ranking from before the map zoomed in.
  kept: boolean;
}

export function HotspotList({ items, inView, total, selectedId, sort, onSort, onSelect, onShowMore, onExport, canExport, kept }: Props) {
  return (
    <section aria-labelledby="top-heading">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 id="top-heading" className={ui.cardTitle} style={{ fontSize: 24 }}>
          Top in view
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="sort-by" className="visually-hidden">
            Sort by
          </label>
          <select
            id="sort-by"
            className={styles.segment}
            style={{ border: "1.5px solid var(--control-border)", borderRadius: 14, minHeight: 44 }}
            value={sort}
            onChange={(event) => {
              onSort(event.target.value as SortKey);
            }}
          >
            <option value="collisions">Collisions</option>
            <option value="fatal">Fatal collisions</option>
            <option value="share">Fatal and Serious share</option>
          </select>
          <button type="button" className={ui.btnSecondary} onClick={onExport} disabled={!canExport}>
            Export CSV
          </button>
        </div>
      </div>

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
