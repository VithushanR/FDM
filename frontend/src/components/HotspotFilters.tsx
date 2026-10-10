import type { HotspotFeatures, PersistenceParam } from "../api/hotspotContract";
import { MONTH_NAMES } from "../api/hotspotContract";
import {
  ALL_TIMES,
  defaultMinimum,
  defaultShow,
  type HotspotFilters as Filters,
  type Subset,
  type ViewBy,
} from "../state/hotspotState";
import { Segmented } from "./Segmented";
import styles from "./hotspots.module.css";

interface Props {
  filters: Filters;
  slices: string[];
  features: HotspotFeatures;
  rules: Record<string, string> | null;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}

const NOT_YET = "Not available: the backend does not provide this filter.";
const SELECT_STYLE = { border: "1.5px solid var(--control-border)", borderRadius: 14, minHeight: 44, padding: "0 10px", background: "#fff" };

// The rules from meta, in a fixed order, with the labels they decide.
const RULE_ROWS: [string, string][] = [
  ["too_few_to_judge", "Too few to judge"],
  ["persistent", "Persistent"],
  ["recent", "Recent"],
  ["fading", "Fading"],
  ["mixed", "Mixed"],
];

export function HotspotFilters({ filters, slices, features, rules, onChange, onReset }: Props) {
  const timeSlices = slices.filter((slice) => slice !== ALL_TIMES);
  const monthOn = features.months === true;
  const persistenceOn = features.persistence === true;

  return (
    <section className={styles.filterBar} aria-label="Hotspot filters">
      <div className={styles.filterGroup}>
        <span className={styles.filterLabel} id="filter-subset">
          Collisions shown
        </span>
        <Segmented<Subset>
          label="Collisions shown"
          value={filters.subset}
          options={[
            { value: "severe", label: "Fatal and Serious" },
            { value: "all", label: "All collisions" },
          ]}
          onChange={(subset) => {
            onChange({ subset, minCollisions: defaultMinimum(subset), show: defaultShow(subset) });
          }}
        />
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel} id="filter-view">
          View by
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Segmented<ViewBy>
            label="View by"
            value={filters.viewBy}
            options={[
              { value: "all", label: "All times" },
              { value: "time", label: "Time of day" },
              { value: "month", label: "Month", disabled: !monthOn, title: monthOn ? undefined : NOT_YET },
            ]}
            onChange={(viewBy) => {
              // Time of day and month are exclusive: choosing one clears the other.
              onChange({
                viewBy,
                slice: viewBy === "time" ? (timeSlices[0] ?? ALL_TIMES) : ALL_TIMES,
                month: viewBy === "month" ? (filters.month ?? 1) : null,
              });
            }}
          />
          {filters.viewBy === "time" ? (
            <>
              <label htmlFor="time-slice" className="visually-hidden">
                Time of day
              </label>
              <select
                id="time-slice"
                style={SELECT_STYLE}
                value={filters.slice}
                onChange={(event) => {
                  onChange({ slice: event.target.value });
                }}
              >
                {timeSlices.map((slice) => (
                  <option key={slice} value={slice}>
                    {slice}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {filters.viewBy === "month" ? (
            <>
              <label htmlFor="month" className="visually-hidden">
                Month
              </label>
              <select
                id="month"
                style={SELECT_STYLE}
                value={filters.month ?? 1}
                onChange={(event) => {
                  onChange({ month: Number(event.target.value), slice: ALL_TIMES });
                }}
              >
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel} id="min-label">
          Minimum collisions
        </span>
        <div className={styles.stepper} role="group" aria-labelledby="min-label">
          <button
            type="button"
            className={styles.stepButton}
            aria-label="Decrease minimum collisions"
            disabled={filters.minCollisions <= 1}
            onClick={() => {
              onChange({ minCollisions: Math.max(1, filters.minCollisions - 1) });
            }}
          >
            −
          </button>
          <span className={styles.stepValue} aria-live="polite">
            {filters.minCollisions}
          </span>
          <button
            type="button"
            className={styles.stepButton}
            aria-label="Increase minimum collisions"
            onClick={() => {
              onChange({ minCollisions: filters.minCollisions + 1 });
            }}
          >
            +
          </button>
        </div>
      </div>

      <div className={styles.filterGroup}>
        <label className={styles.filterLabel} htmlFor="persistence">
          Persistence
        </label>
        <select
          id="persistence"
          style={SELECT_STYLE}
          disabled={!persistenceOn}
          title={persistenceOn ? undefined : NOT_YET}
          value={filters.persistence}
          onChange={(event) => {
            onChange({ persistence: event.target.value as PersistenceParam });
          }}
        >
          <option value="any">Any</option>
          <option value="persistent">Persistent</option>
          <option value="recent">Recent</option>
          <option value="fading">Fading</option>
          <option value="mixed">Mixed</option>
        </select>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
        <button type="button" className={styles.segment} style={{ border: 0, color: "var(--blue)", textDecoration: "underline", background: "none" }} onClick={onReset}>
          Reset filters
        </button>
      </div>

      {persistenceOn && rules ? (
        <details style={{ flexBasis: "100%" }}>
          <summary style={{ cursor: "pointer", color: "var(--blue)", fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center" }}>
            How persistence is decided
          </summary>
          <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "180px 1fr", gap: "4px 14px", fontSize: 14 }}>
            {RULE_ROWS.map(([key, label]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 700 }}>{label}</dt>
                <dd style={{ margin: 0 }}>{rules[key] ?? ""}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
