// Persistence label as a pill. Colours follow the design system. "Too few to judge" is a label only, shown in muted text.
const PILL: Record<string, { background: string; color: string }> = {
  Persistent: { background: "#DCE7F6", color: "#0A3F86" },
  Recent: { background: "#FBF3E4", color: "#5F3A00" },
  Fading: { background: "#EDF0F2", color: "#2B3844" },
  Mixed: { background: "#EDF0F2", color: "#2B3844" },
  "Too few to judge": { background: "#EDF0F2", color: "#4F5B67" },
};

export function Pill({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  const colours = PILL[label] ?? { background: "#EDF0F2", color: "#2B3844" };
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 13,
        fontWeight: 700,
        background: colours.background,
        color: colours.color,
      }}
    >
      {label}
    </span>
  );
}
