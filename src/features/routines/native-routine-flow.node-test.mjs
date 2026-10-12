import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function declaration(path, marker) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const open = source.indexOf('{', start);
  let depth = 1;
  for (let index = open + 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Unclosed declaration ${marker}`);
}

test('native weekday move confirms the same row and evolution requests stay account-scoped', { timeout: 60000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-routine-flow-'));
  try {
    const source = [
      'import Foundation',
      'enum NativeFailure: Error { case message(String) }',
      '@MainActor final class NativeAuth { struct User { let id: String }; struct Session { let user: User }; var session: Session?; var generation = UUID(); init(_ owner: String) { session = Session(user: User(id: owner)) } }',
      declaration('ios/App/Native/native-models.swift', 'struct NativeRoutineDay:'),
      declaration('ios/App/Native/native-routine-views.swift', 'struct NativeRoutineDayMove {'),
      declaration('ios/App/Native/native-routine-views.swift', '@MainActor enum NativeExerciseProgressRequest {'),
      `
@main struct RoutineFlowRegression {
  @MainActor static func main() throws {
    let day = NativeRoutineDay(id: "day", user_id: "owner", routine_id: "routine", label: "Torso", weekday: 1)
    let move = NativeRoutineDayMove(day: day, destination: 3)
    precondition(move.query.map { $0.name } == ["id", "routine_id", "weekday"])
    precondition(move.query.map { $0.value! } == ["eq.day", "eq.routine", "eq.1"])
    let saved = NativeRoutineDay(id: "day", user_id: "owner", routine_id: "routine", label: "Torso", weekday: 3)
    try move.validate([saved], owner: "owner")
    // A concurrent rename must survive a weekday-only update.
    try move.validate([NativeRoutineDay(id: "day", user_id: "owner", routine_id: "routine", label: "Torso renombrado", weekday: 3)], owner: "owner")
    func rejected(_ rows: [NativeRoutineDay], owner: String = "owner") {
      do { try move.validate(rows, owner: owner); preconditionFailure("Accepted an unconfirmed or foreign day") } catch { }
    }
    rejected([])
    rejected([saved, saved])
    rejected([day])
    rejected([saved], owner: "other")
    rejected([NativeRoutineDay(id: "other-day", user_id: "owner", routine_id: "routine", label: "Torso", weekday: 3)])
    let auth = NativeAuth("owner")
    NativeExerciseProgressRequest.prepare(exerciseID: "bench", auth: auth)
    precondition(NativeExerciseProgressRequest.consume(auth: auth) == "bench")
    precondition(NativeExerciseProgressRequest.consume(auth: auth) == nil)
    NativeExerciseProgressRequest.prepare(exerciseID: "bench", auth: auth)
    auth.generation = UUID()
    precondition(NativeExerciseProgressRequest.consume(auth: auth) == nil)
    NativeExerciseProgressRequest.prepare(exerciseID: "bench", auth: auth)
    precondition(NativeExerciseProgressRequest.consume(auth: NativeAuth("other")) == nil)
    precondition(NativeExerciseProgressRequest.consume(auth: auth) == nil)
    print("native routine flow passed")
  }
}`,
    ].join('\n');
    const file = join(directory, 'routine.swift'), binary = join(directory, 'routine');
    writeFileSync(file, source);
    const build = spawnSync('swiftc', ['-parse-as-library', file, '-o', binary], { encoding: 'utf8', timeout: 45000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /native routine flow passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
