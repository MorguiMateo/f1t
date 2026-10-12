import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("native signout reviews drafts, outbox, and unreadable journals instead of implicitly discarding", () => {
  const source = readFileSync(new URL("../../../ios/App/Native/native-body-views.swift", import.meta.url), "utf8");
  const start = source.indexOf("enum NativeSignOutPolicy {");
  const end = source.indexOf("\n@MainActor\nenum NativeProfileRoute", start);
  assert(start >= 0 && end > start);
  const directory = mkdtempSync(join(tmpdir(), "f1t-signout-policy-"));
  try {
    writeFileSync(join(directory, "main.swift"), source.slice(start, end) + `
func decision(_ drafts: Int, _ outbox: Int, _ unreadable: Bool = false, _ bodyPending: Bool = false, _ syncing: Bool = false) -> NativeSignOutPolicy.Decision {
  NativeSignOutPolicy.decision(drafts: drafts, outbox: outbox, unreadable: unreadable, bodyPending: bodyPending, syncing: syncing)
}
precondition(decision(0, 0) == .close)
precondition(decision(1, 0) == .review)
precondition(decision(0, 1) == .review)
precondition(decision(2, 3) == .review)
precondition(decision(0, 0, true) == .review)
precondition(decision(0, 0, false, true) == .wait)
precondition(decision(0, 1, false, false, true) == .wait)
print("native signout policy passed")
`);
    execFileSync("xcrun", ["swiftc", join(directory, "main.swift"), "-o", join(directory, "check")]);
    assert.match(execFileSync(join(directory, "check"), { encoding: "utf8" }), /passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
