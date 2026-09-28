import { Link } from "react-router";
import {
  Skeleton,
  SkeletonGroup,
  SkeletonLine,
} from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import { useSessionDays } from "../sessions/queries";
import {
  ACTIVITY_WINDOW_DAYS,
  BMI_CATEGORY_LABELS,
  energyReport,
  MISSING_LABELS,
} from "./energy";
import { GOAL_LABELS } from "./profile";
import { useBodyProfile, useWeightEntries } from "./queries";
import { latestWeight } from "./weight";

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
      <p className="mt-0.5 truncate text-xs text-muted">{label}</p>
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
      <h2 className="font-semibold">Calorías</h2>
      <SkeletonLine className="mt-3 w-40 text-3xl" />
      <SkeletonLine className="mt-1 w-28 text-xs" />
      <div className="mt-4 flex gap-2">
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
  const { data: profile } = useBodyProfile();
  const weights = useWeightEntries();
  const sessions = useSessionDays();

  if (weights.isPending || sessions.isPending) {
    return <EnergyCardSkeleton />;
  }

  const error = weights.error ?? sessions.error;
  if (error) return <ErrorNote error={error} />;

  const report = energyReport({
    profile: profile ?? null,
    latestWeightKg: latestWeight(weights.data ?? []),
    sessionDays: sessions.data ?? [],
  });

  if (report.status === "missing") {
    const missing = LIST_FORMATTER.format(
      report.missing.map((field) => MISSING_LABELS[field]),
    );
    return (
      <section className="rounded-xl border border-dashed border-line p-5 text-muted">
        <h2 className="font-semibold">Calorías</h2>
        <p className="mt-2 text-sm">
          Para calcular tu gasto y tu objetivo diario falta {missing}.
        </p>
        {report.missing.includes("weight") ? (
          <Link
            to="/progreso"
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
            · {BMI_CATEGORY_LABELS[report.bmi.category]}
          </p>
        ) : null}
      </section>
    );
  }

  const { activity, target } = report;
  const perWeek = formatDecimal(activity.daysPerWeek);

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Calorías</h2>

      <p className="mt-3 text-3xl font-bold tnum">
        {KCAL_FORMATTER.format(target.kcal)}
        <span className="ml-1 text-base font-normal text-muted">kcal/día</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        {GOAL_LABELS[report.goal]} · {formatAdjustment(target.adjustment)}
      </p>
      {target.clamped ? (
        <p className="mt-1 text-xs text-muted">
          Subido a tu metabolismo basal: comer menos que eso no es un déficit
          sano.
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Figure
          value={formatDecimal(report.bmi.value)}
          label={`IMC · ${BMI_CATEGORY_LABELS[report.bmi.category]}`}
        />
        <Figure
          value={KCAL_FORMATTER.format(report.bmr)}
          unit="kcal"
          label="En reposo"
        />
        <Figure
          value={KCAL_FORMATTER.format(report.tdee)}
          unit="kcal"
          label="Gasto diario"
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        {perWeek} {activity.daysPerWeek === 1 ? "entrenamiento" : "entrenamientos"}
        /semana en las últimas {ACTIVITY_WINDOW_DAYS / 7} semanas · actividad{" "}
        {activity.label}
      </p>
    </section>
  );
}
