import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseCard } from "../exercises/exercise-card";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), mutate: vi.fn(), cards: [] as Parameters<typeof ExerciseCard>[0][],
  header: null as null | { onBack?: () => void },
  existing: ["Barbell_Bench_Press_-_Medium_Grip"], pending: false,
}));
vi.mock("react-router", async (original) => ({ ...await original<typeof import("react-router")>(), useNavigate: () => mocks.navigate }));
vi.mock("../../components/page-header", () => ({ PageHeader: (props: { title: string; subtitle?: string; onBack?: () => void }) => { mocks.header = props; return <header>{props.title} {props.subtitle}</header>; } }));
vi.mock("../exercises/exercise-card", () => ({ ExerciseCard: (props: Parameters<typeof ExerciseCard>[0]) => { mocks.cards.push(props); return <li>{props.exercise.name}</li>; } }));
vi.mock("./queries", () => ({
  useAddExercise: () => ({ mutate: mocks.mutate, isPending: mocks.pending, error: null }),
  useRoutineDetail: () => ({ data: { id: "routine", name: "Mi rutina", days: [{ id: "day", label: "Torso", weekday: 1, exercises: mocks.existing.map((id) => ({ exercise_id: id })) }] }, isPending: false, error: null }),
}));
import { ExercisesPage } from "../../pages/exercises-page";
function render(fromDay = true, query = "") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: "/ejercicios", search: `?dia=day&rutina=routine${query}`, state: fromDay ? { fromRoutineDay: true } : null }]}><ExercisesPage /></MemoryRouter>);
}
beforeEach(() => { mocks.navigate.mockReset(); mocks.mutate.mockReset(); mocks.cards = []; mocks.header = null; mocks.pending = false; });
describe("persistent multi-add picker", () => {
  it("identifies the destination and marks existing exercises before an add", () => {
    const html = render();
    expect(html).toContain("Mi rutina · Torso · Lunes");
    expect(mocks.cards.find((card) => card.exercise.id === mocks.existing[0])?.added).toBe(true);
  });
  it("stays open after each add and guards rapid double taps", () => {
    render();
    const card = mocks.cards.find((item) => !item.added)!;
    card.onSelect!(); card.onSelect!();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const callbacks = mocks.mutate.mock.calls[0][1];
    callbacks.onSuccess();
    callbacks.onSettled();
    const second = mocks.cards.find((item) => !item.added && item !== card)!;
    second.onSelect!();
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("does not insert an existing exercise", () => {
    render();
    mocks.cards.find((card) => card.added)!.onSelect!();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("finishes by popping to an existing day instead of adding a duplicate history entry", () => {
    render(); mocks.header!.onBack!();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(-1);
  });
  it("uses replace for a freshly created/directly linked day", () => {
    render(false); mocks.header!.onBack!();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/rutinas/routine/dias/day", { replace: true });
  });
  it("passes the retained query and destination to the technique link", () => {
    render(true, "&q=press&musculo=chest&equipo=barbell");
    expect(mocks.cards.length).toBeGreaterThan(0);
    const detail = new URL(mocks.cards[0].detailsTo!, "https://fit.invalid");
    expect(detail.searchParams.get("q")).toBe("press");
    expect(detail.searchParams.get("musculo")).toBe("chest");
    expect(detail.searchParams.get("equipo")).toBe("barbell");
    expect(detail.searchParams.get("dia")).toBe("day");
  });
});
