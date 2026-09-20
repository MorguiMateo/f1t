import Model, { type IExerciseData } from "react-body-highlighter";
import { toBodyParts } from "../../lib/muscles";

/**
 * An exercise's body map.
 *
 * The dataset's two photos show the movement, not the anatomy, so "which
 * muscles does this train" needs its own drawing. Both views are shown
 * because the dataset has muscles that only exist in one: the chest isn't
 * visible from behind and the glutes aren't visible from the front.
 *
 * Primary and secondary are told apart by intensity and not by a different
 * colour: same idea as the heatmap — a single hue carries less visual load
 * and still reads if the system flattens colours.
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

  // A muscle that is both primary and secondary counts once, as primary:
  // otherwise the frequencies add up and overflow the range.
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
          // Colours via CSS vars: the map follows the theme without a re-render.
          bodyColor="var(--surface-2)"
          highlightedColors={["var(--muted)", "var(--accent)"]}
          style={{ width: "50%", maxWidth: "9rem" }}
        />
      ))}
    </div>
  );
}
