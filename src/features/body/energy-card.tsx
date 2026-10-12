import { Link } from "react-router";
import {
  Skeleton,
  SkeletonGroup,
  SkeletonLine,
} from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import { fromDateKey, toDateKey } from "../../lib/heatmap";
import {
  ACTIVITY_WINDOW_DAYS,
  MISSING_LABELS,
} from "./energy";
import { formatKg } from "./weight";
import { GOAL_LABELS } from "./profile";
import { useEnergyReportForDate } from "./queries";

/**
 * BMI, resting and daily burn, and the calorie target. Every number comes
 * from `energy.ts`; this file only lays them out.
 *
 * Until the inputs exist the card stays grey and names what is missing,
 * rather than showing `NaN`. As in the weight chart, nothing is coloured as
 * good or bad: a BMI band is a fact about the number, not a verdict.
 */

const LIST_FORMATTER = new Intl.ListFormat("es", { type: "conjunction" });
const KCAL_FORMATTER = new Intl.NumberFormat("es");

function formatDecimal(value: number): string {
  return String(value).replace(".", ",");
}

/** Signed with the real minus (U+2212), like `formatDelta`. */
function formatAdjustment(kcal: number): string {
  if (kcal === 0) return "igual a tu gasto diario";
  const sign = kcal > 0 ? "+" : "−";
  return `${sign}${KCAL_FORMATTER.format(Math.abs(kcal))} kcal`;
}

function Figure({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 p-3 text-center">
      <p className="font-bold tnum">
        {value}
        {unit ? (
          <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>
        ) : null}
      </p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </div>
  );
}

/**
 * The ready card's layout line for line: target, goal, the three figures and
 * the activity line. Most people who open Perfil have filled it in, so that
 * is the shape worth reserving.
 */
export function EnergyCardSkeleton() {
  return (
    <SkeletonGroup className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Estimación de calorías</h2>
      <SkeletonLine className="mt-3 w-40 text-3xl" />
      <SkeletonLine className="mt-1 w-28 text-xs" />
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((index) => (
          // The figure's own box and padding, pulsing as a whole: a bar in
          // `bg-surface-2` would vanish against the box's `bg-surface-2`.
          <Skeleton key={index} className="min-w-0 flex-1 rounded-xl p-3">
            <div className="h-[1lh]" />
            <div className="mt-0.5 h-[1lh] text-xs" />
          </Skeleton>
        ))}
      </div>
      <SkeletonLine className="mt-3 w-4/5 text-xs" />
    </SkeletonGroup>
  );
}

export function EnergyCard() {
  const { report, isPending, error, sourceWeight } = useEnergyReportForDate(toDateKey(new Date()));

  if (isPending) {
    return <EnergyCardSkeleton />;
  }

  if (error) return <ErrorNote error={error} />;
  if (!report) return <EnergyCardSkeleton />;

  if (report.status === "missing") {
    const missing = LIST_FORMATTER.format(
      report.missing.map((field) => MISSING_LABELS[field]),
    );
    return (
      <section className="rounded-xl border border-dashed border-line p-5 text-muted">
        <h2 className="font-semibold">Estimación de calorías</h2>
        <p className="mt-2 text-sm">
          Para obtener una referencia diaria calculada falta {missing}.
        </p>
        {report.missing.includes("weight") ? (
          <Link
            to="/progreso?seccion=cuerpo&anotar=1#peso"
            className="mt-2 inline-block text-sm font-medium text-accent"
          >
            Anotar un peso
          </Link>
        ) : null}
        {report.bmi ? (
          <p className="mt-3 text-sm">
            IMC{" "}
            <span className="font-semibold text-ink tnum">
              {formatDecimal(report.bmi.value)}
            </span>{" "}
            kg/m² (peso / altura²)
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted">Los datos son opcionales para usar F1t. El IMC no describe la composición corporal; la estimación usa los datos guardados.</p>
      </section>
    );
  }

  const { activity, target } = report;
  const perWeek = formatDecimal(activity.daysPerWeek);

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Estimación de calorías</h2>

      <p className="mt-3 text-sm text-muted">Referencia diaria calculada · redondeada a 50 kcal</p>
      <p className="mt-1 text-3xl font-bold tnum">
        {KCAL_FORMATTER.format(target.kcal)}
        <span className="ml-1 text-base font-normal text-muted">kcal/día</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        {GOAL_LABELS[report.goal]} · {formatAdjustment(target.adjustment)}
      </p>
      {target.clamped ? (
        <p className="mt-1 text-xs text-muted">
          La fórmula limita esta referencia al gasto en reposo estimado. Ese límite no determina cuánto necesitás comer.
        </p>
      ) : null}

      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Cómo se calcula · IMC y gasto estimado</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Figure
          value={formatDecimal(report.bmi.value)}
          unit="kg/m²"
          label="IMC (peso / altura²)"
        />
        <Figure
          value={KCAL_FORMATTER.format(report.bmr)}
          unit="kcal/día"
          label="Reposo estimado"
        />
        <Figure
          value={KCAL_FORMATTER.format(report.tdee)}
          unit="kcal/día"
          label="Gasto diario estimado"
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        {perWeek} días con series por semana en los últimos {ACTIVITY_WINDOW_DAYS} días · factor de actividad {activity.factor}
      </p>
      <p className="mt-2 text-sm text-muted">El factor usa entrenamientos registrados, no mide tu actividad cotidiana. El IMC no describe la composición corporal.</p>
      </details>
      {sourceWeight ? <p className="mt-3 text-sm text-muted">Calculado con {formatKg(sourceWeight.weight_kg)} kg del {fromDateKey(sourceWeight.measured_on).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}. <Link className="inline-flex min-h-11 items-center font-medium text-accent" to="/progreso?seccion=cuerpo&anotar=1#peso">Actualizar peso</Link></p> : null}
      <p className="mt-2 text-sm text-muted">Valores orientativos calculados con tus datos guardados; no son una recomendación de alimentación ni reemplazan asesoramiento profesional.</p>
    </section>
  );
}
