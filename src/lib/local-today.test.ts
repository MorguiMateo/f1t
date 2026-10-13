import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { millisecondsToLocalMidnight, watchLocalToday } from "./local-today";

let stop: (() => void) | undefined;
let windowEvents: EventTarget;
let documentEvents: EventTarget & { visibilityState: string };

beforeEach(() => {
  vi.useFakeTimers();
  windowEvents = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", documentEvents);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local day rollover", () => {
  it("updates across local midnight and year boundaries, not UTC midnight", () => {
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    const update = vi.fn();
    stop = watchLocalToday(update);
    expect(update).toHaveBeenLastCalledWith("2026-12-31");
    vi.advanceTimersByTime(1100);
    expect(update).toHaveBeenLastCalledWith("2027-01-01");
  });

  it("refreshes after a suspended timer when focus or visibility returns", () => {
    vi.setSystemTime(new Date(2026, 9, 9, 10));
    const update = vi.fn();
    stop = watchLocalToday(update);
    vi.setSystemTime(new Date(2026, 9, 10, 10));
    windowEvents.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenLastCalledWith("2026-10-10");
    vi.setSystemTime(new Date(2026, 9, 11, 10));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenLastCalledWith("2026-10-11");
  });

  it("does not refresh in a hidden document and removes listeners and timers", () => {
    vi.setSystemTime(new Date(2026, 9, 9, 10));
    const update = vi.fn();
    stop = watchLocalToday(update);
    documentEvents.visibilityState = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    windowEvents.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(86_400_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("schedules calendar midnight from the current local time", () => {
    const now = new Date(2026, 9, 9, 23, 59, 58);
    expect(millisecondsToLocalMidnight(now)).toBe(2000);
    const morning = new Date(2026, 9, 9, 8, 30);
    const nextMidnight = new Date(2026, 9, 10);
    expect(millisecondsToLocalMidnight(morning)).toBe(nextMidnight.getTime() - morning.getTime());
  });
});
