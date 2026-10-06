import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LatLng, PlaceSearch, PlaceSuggestion } from "../maps/types";
import styles from "./ui.module.css";

export function newSessionToken(): string {
  return crypto.randomUUID();
}

// A custom listbox, so it can match the design. The prebuilt Places element cannot be styled this way.
export function PlaceSearchBox({
  search,
  onPick,
  label = "Search for a place, or click the map",
}: {
  search: PlaceSearch;
  onPick: (point: LatLng, name: string) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const token = useRef(newSessionToken());
  const listId = useId();
  const inputId = useId();

  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      search
        .suggest(query, token.current, controller.signal)
        .then((items) => {
          setSuggestions(items);
          setActive(-1);
          setOpen(items.length > 0);
          setMessage(items.length === 0 ? "No places found." : "");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSuggestions([]);
          setOpen(false);
          setMessage("Place search is not available right now.");
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  async function choose(item: PlaceSuggestion) {
    setOpen(false);
    const place = await search.resolve(item.placeId, token.current).catch(() => null);
    token.current = newSessionToken();
    if (place) {
      setQuery(place.name);
      onPick(place.location, place.name);
    } else {
      setMessage("That place could not be opened. Try another.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && event.key !== "Escape") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      const item = suggestions[active];
      if (item) void choose(item);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div style={{ position: "relative", marginTop: 6 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: 12, top: 11 }}>
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="2" />
        </svg>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className={styles.control}
          style={{ paddingLeft: 40, height: 44 }}
          value={query}
          placeholder="Place name or postcode"
          onChange={(event) => { setQuery(event.target.value); }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Place suggestions"
          style={{
            position: "absolute",
            zIndex: 5,
            left: 0,
            right: 0,
            margin: "4px 0 0",
            padding: 4,
            listStyle: "none",
            background: "#fff",
            border: "1.5px solid var(--frame-outer)",
            borderRadius: 14,
            boxShadow: "var(--shadow-card)",
          }}
        >
          {suggestions.map((item, index) => (
            <li
              key={item.placeId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                void choose(item);
              }}
              style={{
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: index === active ? "var(--selected-row)" : "transparent",
                outline: index === active ? "2px solid var(--blue)" : "none",
              }}
            >
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div role="status" className="sr-announce">
        {message}
      </div>
    </div>
  );
}
