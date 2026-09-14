import Model, { type IExerciseData } from "react-body-highlighter";
import { toBodyParts } from "../../lib/muscles";

/**
 * El mapa corporal de un ejercicio.
 *
 * Las dos fotos del dataset muestran el movimiento, no la anatomía, así que
 * "qué músculos entrena" necesita su propio dibujo. Se muestran las dos
 * vistas porque el dataset tiene músculos que solo existen en una: el pecho
 * no se ve de atrás y los glúteos no se ven de frente.
 *
 * Primarios y secundarios se distinguen por intensidad y no por color
 * distinto: es la misma idea que en el heatmap, un solo tono manda menos
 * carga visual y sigue leyéndose si el sistema aplana los colores.
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

  // Un músculo que es primario y secundario a la vez se cuenta una sola vez,
  // como primario: si no, las frecuencias se suman y se va de rango.
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
          // Colores por CSS var: el mapa sigue al tema sin re-renderizar.
          bodyColor="var(--surface-2)"
          highlightedColors={["var(--muted)", "var(--accent)"]}
          style={{ width: "50%", maxWidth: "9rem" }}
        />
      ))}
    </div>
  );
}
