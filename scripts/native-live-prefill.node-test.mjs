import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Compile the actual pure production declarations, not a reimplementation of
// selection/prefill. ActivityKit and thumbnail I/O stay outside this fixture.
function declaration(path, marker) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing production declaration: ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 1;
  for (let index = open + 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Unclosed production declaration: ${marker}`);
}

test('Live Activity prefill matches confirmed earlier sets, history and targets without registering anything', { timeout: 60000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-live-prefill-'));
  try {
    const native = 'ios/App/Native/';
    const source = [
      'import Foundation',
      'protocol ActivityAttributes {}',
      ...['NativeRoutineExercise', 'NativeExercise', 'NativeSet'].map(name =>
        declaration(`${native}native-models.swift`, `struct ${name}:`)),
      declaration(`${native}native-workout-views.swift`, 'enum NativeWorkoutProgress {'),
      declaration(`${native}native-exercise-log.swift`, 'enum NativeSetPrefill {'),
      declaration('ios/App/Shared/workout-activity.swift', 'struct F1tWorkoutAttributes:'),
      `enum F1tThumbnailStorage { ${declaration('ios/App/Shared/workout-activity.swift', 'static func filename(for exerciseID:')} }`,
      `enum FitFormat { ${declaration(`${native}native-format.swift`, 'static func targetReps(_ text:')} }`,
      declaration(`${native}native-live-activity.swift`, 'enum NativeLiveActivityState {'),
      `
@main struct PrefillRegression {
    static func item(_ id: String, weight: Double? = 40) -> NativeRoutineExercise {
        .init(id: id, user_id: "owner", routine_day_id: "day", exercise_id: id,
              position: 0, target_sets: 4, target_reps: "8-12", notes: nil, target_weight_kg: weight)
    }
    static func set(_ id: String, _ index: Int, _ reps: Int?, _ weight: Double?) -> NativeSet {
        .init(id: "\\(id)-\\(index)", user_id: "owner", session_id: "session",
              exercise_id: id, set_index: index, reps: reps, weight_kg: weight)
    }
    static func state(_ sets: [NativeSet], past: [NativeSet] = [], weight: Double? = 40,
                      selected: String? = nil) -> F1tWorkoutAttributes.ContentState {
        NativeLiveActivityState.make(plan: [item("a", weight: weight), item("b", weight: weight)],
            sets: sets, past: past, exercise: { _ in nil }, restEndsAt: nil, currentExerciseID: selected)
    }
    static func check(_ state: F1tWorkoutAttributes.ContentState, id: String = "a", index: Int,
                      reps: Int?, weight: Double?, _ message: String) {
        precondition(state.exerciseID == id && state.setIndex == index, message + ": selection")
        precondition(state.reps == reps && state.weightKg == weight, message + ": values")
    }
    static func main() throws {
        let unordered = [set("a", 1, 7, 0), set("b", 1, 99, 999), set("a", 0, 10, 42.5)]
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let before = try encoder.encode(unordered)
        let carried = state(unordered, past: [set("a", 2, 12, 99)])
        check(carried, index: 2, reps: 7, weight: 0, "highest earlier index beats history and target, including zero")
        precondition(carried.completedSets == 3 && carried.plannedSets == 8, "prefill must not register the next set")
        let after = try encoder.encode(unordered)
        precondition(after == before, "confirmed values stay untouched")

        check(state([set("a", 2, 14, 65), set("a", 0, 9, 45)]),
              index: 1, reps: 9, weight: 45, "a later saved set cannot prefill a gap")
        check(state([set("a", 2, 14, 65), set("b", 0, 99, 999)],
                    past: [set("b", 0, 99, 999), set("a", 1, 99, 999), set("a", 0, 11, 90)]),
              index: 0, reps: 11, weight: 40, "matching history reps and routine weight for first set")
        check(state([]), index: 0, reps: 8, weight: 40, "routine-only first set")
        check(state([set("a", 0, nil, nil)], past: [set("a", 1, 13, 55)]),
              index: 1, reps: 13, weight: 40, "nil earlier fields use per-field fallback")
        check(state([set("a", 0, 6, nil)], past: [set("a", 1, 13, 55)], weight: nil),
              index: 1, reps: 6, weight: 55, "missing earlier weight and target use matching history")
        check(state([set("a", 0, 0, 0)]), index: 1, reps: 0, weight: 0, "explicit zero is not missing")
        check(state([set("a", 0, 99, 999), set("b", 0, 5, 25)], selected: "b"),
              id: "b", index: 1, reps: 5, weight: 25, "explicitly selected exercise uses its own earlier set")
        check(state([], weight: nil), index: 0, reps: 8, weight: nil, "no invented weight")
        let finished = state((0..<4).flatMap { [set("a", $0, 10, 50), set("b", $0, 8, 30)] })
        precondition(finished.phase == .finished && finished.reps == nil && finished.weightKg == nil,
                     "complete workout has no next-set suggestion")
        print("Live Activity production prefill regression passed")
    }
}
`,
    ].join('\n');
    const path = join(directory, 'Regression.swift');
    const executable = join(directory, 'checks');
    writeFileSync(path, source);
    const compile = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', path, '-o', executable],
      { encoding: 'utf8', timeout: 45000 });
    assert.equal(compile.error, undefined, compile.error?.message);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Live Activity production prefill regression passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
