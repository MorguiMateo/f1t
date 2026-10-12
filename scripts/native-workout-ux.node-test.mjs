import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Run the production Swift helpers. OS notification delivery and SwiftUI layout
// remain integration checks; no algorithm is reimplemented in this fixture.
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
  assert.fail(`Unclosed declaration: ${marker}`);
}

test('workout navigation, finish review, increments and permission actions preserve user intent', { timeout: 60000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-workout-ux-'));
  try {
    const native = 'ios/App/Native/';
    const source = [
      'import Foundation',
      ...['NativeRoutineExercise', 'NativeSet'].map(name => declaration(`${native}native-models.swift`, `struct ${name}:`)),
      declaration(`${native}native-workout-views.swift`, 'enum NativeWorkoutProgress {'),
      declaration(`${native}native-workout-views.swift`, 'struct NativeWorkoutDraftReference:'),
      declaration(`${native}native-workout-views.swift`, 'struct NativeWorkoutFinishSummary {'),
      declaration(`${native}native-exercise-log.swift`, 'enum NativeWorkoutWeightIncrement {'),
      'enum UNAuthorizationStatus { case notDetermined, denied, authorized, provisional, ephemeral }',
      declaration(`${native}native-rest-notifications.swift`, 'enum NativeRestPermissionAction:'),
      `enum NativeWorkoutRepository {
        enum Mutation { ${declaration(`${native}native-workout-persistence.swift`, 'static func key(date:')} }
        ${declaration(`${native}native-workout-persistence.swift`, 'static func draftKey(date:')}
      }`,
      String.raw`
@main struct WorkoutUXRegression {
    static func item(_ id: String, sets: Int? = 2) -> NativeRoutineExercise {
        .init(id: id, user_id: "owner", routine_day_id: "day", exercise_id: id,
              position: 0, target_sets: sets, target_reps: "8-12", notes: nil, target_weight_kg: 40)
    }
    static func saved(_ id: String, _ index: Int) -> NativeSet {
        .init(id: "\(id)-\(index)", user_id: "owner", session_id: "session", exercise_id: id,
              set_index: index, reps: 8, weight_kg: 40)
    }
    static func key(_ exercise: String, _ index: Int, date: String = "2026-10-10", day: String? = "day") -> String {
        NativeWorkoutRepository.draftKey(date: date, dayID: day, exerciseID: exercise, index: index)
    }
    static func main() throws {
        let order = ["a", "b", "c"]
        var selected = "a"
        for expected in ["b", "c", "a", "b", "c"] {
            selected = NativeWorkoutProgress.nextPending(after: selected, order: order, pending: order)!
            precondition(selected == expected, "postponing must reach C instead of looping A/B")
        }
        precondition(NativeWorkoutProgress.nextPending(after: "a", order: order, pending: ["a", "c"]) == "c")
        precondition(NativeWorkoutProgress.nextPending(after: "c", order: order, pending: ["a", "c"]) == "a")
        precondition(NativeWorkoutProgress.nextPending(after: "a", order: order, pending: ["a"]) == nil)
        precondition(NativeWorkoutProgress.nextPending(after: "a", order: [], pending: []) == nil)
        precondition(NativeWorkoutProgress.nextPending(after: "missing", order: order, pending: ["b"]) == "b")

        let plan = [item("a"), item("b", sets: nil), item("a")]
        let sets = [saved("a", 1), saved("a", 0), saved("extra", 0)]
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let before = try encoder.encode(sets)
        let keys = [key("a", 2), key("b", 0), key("b", 3, day: "other-day"),
                    key("b", 4, date: "2026-10-09"), key("b", 5, day: nil),
                    key("b", -1), key("b", Int.max), "malformed"]
        let summary = NativeWorkoutFinishSummary(plan: plan, sets: sets, draftKeys: keys,
                                                date: "2026-10-10", dayID: "day")
        precondition(summary.confirmedSets == 3, "extra confirmed sets still count")
        precondition(summary.pendingExercises == 1, "deduplicate exercises; nil target requires one set")
        precondition(summary.drafts == [.init(exerciseID: "a", index: 2), .init(exerciseID: "b", index: 0)],
                     "review only the matching date and routine day, with valid indexes")
        let after = try encoder.encode(sets)
        precondition(before == after, "review cannot register, correct or delete sets")
        precondition(NativeWorkoutDraftReference.scoped(keys: keys, date: "2026-10-10", dayID: nil) ==
                     [.init(exerciseID: "b", index: 5)], "nil day never borrows another day's draft")
        let complete = NativeWorkoutFinishSummary(plan: plan, sets: sets + [saved("b", 0)],
                                                 draftKeys: [key("a", 0)], date: "2026-10-10", dayID: "day")
        precondition(complete.pendingExercises == 0 && complete.drafts.count == 1,
                     "completed workouts can still have an unconfirmed correction")

        let suite = "fit-workout-increments-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        precondition(NativeWorkoutWeightIncrement.read(ownerID: "one", exerciseID: "a", defaults: defaults) == 2.5)
        NativeWorkoutWeightIncrement.save(1.25, ownerID: "one", exerciseID: "a", defaults: defaults)
        precondition(NativeWorkoutWeightIncrement.read(ownerID: "one", exerciseID: "a", defaults: defaults) == 1.25)
        precondition(NativeWorkoutWeightIncrement.read(ownerID: "two", exerciseID: "a", defaults: defaults) == 2.5)
        precondition(NativeWorkoutWeightIncrement.read(ownerID: "one", exerciseID: "b", defaults: defaults) == 2.5)
        precondition(NativeWorkoutWeightIncrement.key(ownerID: "a.b", exerciseID: "c") !=
                     NativeWorkoutWeightIncrement.key(ownerID: "a", exerciseID: "b.c"), "scope keys must not collide")
        precondition(NativeWorkoutWeightIncrement.key(ownerID: nil, exerciseID: "a") == nil)
        precondition(NativeWorkoutWeightIncrement.key(ownerID: "", exerciseID: "a") == nil)
        NativeWorkoutWeightIncrement.save(5, ownerID: nil, exerciseID: "a", defaults: defaults)
        precondition(NativeWorkoutWeightIncrement.read(ownerID: nil, exerciseID: "a", defaults: defaults) == 2.5)
        for invalid in [Double.nan, Double.infinity, -1, 0, 3] {
            precondition(NativeWorkoutWeightIncrement.normalized(invalid) == 2.5)
        }

        precondition(NativeRestPermissionAction.resolve(nil) == .loading)
        precondition(NativeRestPermissionAction.resolve(.notDetermined) == .request)
        precondition(NativeRestPermissionAction.resolve(.denied) == .settings)
        for status: UNAuthorizationStatus in [.authorized, .provisional, .ephemeral] {
            precondition(NativeRestPermissionAction.resolve(status) == .toggle)
        }
        print("Workout UX production helpers passed")
    }
}
`,
    ].join('\n');
    const path = join(directory, 'WorkoutUXRegression.swift');
    const executable = join(directory, 'checks');
    writeFileSync(path, source);
    const compile = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', path, '-o', executable],
      { encoding: 'utf8', timeout: 45000 });
    assert.equal(compile.error, undefined, compile.error?.message);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Workout UX production helpers passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
