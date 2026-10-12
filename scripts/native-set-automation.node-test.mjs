import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('native performed-set prefill and explicit registration validation execute in Swift', () => {
  const models = readFileSync('ios/App/Native/native-models.swift', 'utf8');
  const source = readFileSync('ios/App/Native/native-exercise-log.swift', 'utf8');
  const set = models.slice(models.indexOf('struct NativeSet:'), models.indexOf('struct NativeWeight:'));
  const number = models.slice(models.indexOf('func nativeNumber('), models.indexOf('func nativeQuery('));
  const prefill = source.slice(source.indexOf('enum NativeSetPrefill {'), source.indexOf('struct NativeExerciseLog:'));
  const input = source.slice(source.indexOf('enum NativeWorkoutInput {'), source.indexOf('struct NativeSetRow:'));
  const fixture = `
func row(_ reps: Int?, _ weight: Double?) -> NativeSet {
    NativeSet(id: "set", user_id: "user", session_id: "session", exercise_id: "press", set_index: 0, reps: reps, weight_kg: weight)
}
let old = row(8, 55)
let copied = NativeSetPrefill.values(saved: nil, earlier: row(10, 67.5), previous: old, targetReps: 8, targetWeight: 60)
precondition(copied.reps == 10 && copied.weight == 67.5)
let zero = NativeSetPrefill.values(saved: nil, earlier: row(0, 0), previous: old, targetReps: 8, targetWeight: 60)
precondition(zero.reps == 0 && zero.weight == 0)
let saved = NativeSetPrefill.values(saved: row(nil, nil), earlier: row(10, 65), previous: old, targetReps: 8, targetWeight: 60)
precondition(saved.reps == nil && saved.weight == nil)
let target = NativeSetPrefill.values(saved: nil, earlier: nil, previous: old, targetReps: 8, targetWeight: 0)
precondition(target.reps == 8 && target.weight == 0)
let history = NativeSetPrefill.values(saved: nil, earlier: nil, previous: old, targetReps: 12, targetWeight: nil)
precondition(history.reps == 8 && history.weight == 55)
let fallback = NativeSetPrefill.values(saved: nil, earlier: nil, previous: nil, targetReps: 12, targetWeight: 60)
precondition(fallback.reps == 12 && fallback.weight == 60)
precondition(NativeWorkoutInput.registrationError(reps: "", weight: "60", isNew: true) != nil)
precondition(NativeWorkoutInput.registrationError(reps: "", weight: "", isNew: false) == nil)
precondition(NativeWorkoutInput.registrationError(reps: "8", weight: "", isNew: true) == nil)
precondition(NativeWorkoutInput.registrationError(reps: "8", weight: "62,5", isNew: true) == nil)
precondition(NativeWorkoutInput.parse(reps: "8", weight: "62,5")?.weight == 62.5)
for invalid in ["oops", "-1", "1000", "1.5"] {
    precondition(NativeWorkoutInput.registrationError(reps: invalid, weight: "60", isNew: true) != nil)
}
for invalid in ["oops", "-1", "10000", "17,555", "1e3"] {
    precondition(NativeWorkoutInput.registrationError(reps: "8", weight: invalid, isNew: true) != nil)
}
print("native set automation assertions passed")
`;
  const directory = mkdtempSync(join(tmpdir(), 'f1t-set-automation-'));
  try {
    const file = join(directory, 'main.swift');
    writeFileSync(file, `import Foundation\n${set}\n${number}\n${prefill}\n${input}\n${fixture}`);
    const result = spawnSync('xcrun', ['swift', file], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /native set automation assertions passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
