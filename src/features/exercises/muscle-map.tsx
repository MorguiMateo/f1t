import Model, { type IExerciseData } from "react-body-highlighter";
import { toBodyParts } from "../../lib/muscles";

/**
 * Both views because some muscles only appear in one (chest, glutes). Primary
 * vs secondary is intensity of a single hue, which survives flattened colours.
 */
export function MuscleMap({
  primary,
  secondary,
}: {
  primary: readonly string[];
  secondary: readonly string[];
}) {
  const primaryParts = toBodyParts(primary);
  const primarySet = new Set(primaryParts);

  // Otherwise overlapping frequencies add up and overflow the colour range.
  const secondaryParts = toBodyParts(secondary).filter(
    (part) => !primarySet.has(part),
  );

  const data: IExerciseData[] = [
    { name: "Secundarios", muscles: secondaryParts, frequency: 1 },
    { name: "Primarios", muscles: primaryParts, frequency: 2 },
  ];

  return (
    <div className="flex items-center justify-center gap-2">
      {(["anterior", "posterior"] as const).map((type) => (
        <Model
          key={type}
          type={type}
          data={data}
          // CSS vars follow the theme without a re-render.
          bodyColor="var(--surface-2)"
          highlightedColors={["var(--muted)", "var(--accent)"]}
          style={{ width: "50%", maxWidth: "9rem" }}
        />
      ))}
    </div>
  );
}
