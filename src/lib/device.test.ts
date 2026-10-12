import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceBridge, device, setWidgetDebugIdentity, signOutAfterDeviceCleanup, type NativeActivityPlugin, type NativeWidgetPlugin, type Reminder, type WidgetPayload } from "./device";

const DEBUG_KEY = "f1t:widget-payload";
const payload: WidgetPayload = {
  levels: [1, 2],
  todayLabel: "Empuje",
  todayExercises: [{ name: "Press", detail: "3 × 8" }],
  streak: 2,
};

function stubStorage() {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  });
  return entries;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("web widget debug payload", () => {
  it("clears a legacy or previous-account payload on identity change and sign-out", async () => {
    const storage = stubStorage();
    storage.set(DEBUG_KEY, JSON.stringify(payload));
    setWidgetDebugIdentity("widget-user-a");
    expect(storage.has(DEBUG_KEY)).toBe(false);

    await device.syncWidget(payload, "widget-user-a");
    expect(storage.get(DEBUG_KEY)).toBe(JSON.stringify(payload));

    setWidgetDebugIdentity("widget-user-b");
    expect(storage.has(DEBUG_KEY)).toBe(false);
    await device.syncWidget(payload, "widget-user-b");
    setWidgetDebugIdentity(null);
    expect(storage.has(DEBUG_KEY)).toBe(false);
  });

  it("rejects an old owner's sync scheduled after the account changed", async () => {
    const storage = stubStorage();
    setWidgetDebugIdentity("widget-user-c");
    const lateSync = Promise.resolve().then(() =>
      device.syncWidget(payload, "widget-user-c"),
    );
    setWidgetDebugIdentity("widget-user-d");
    await lateSync;
    expect(storage.has(DEBUG_KEY)).toBe(false);

    await device.syncWidget(payload, "widget-user-d");
    expect(storage.get(DEBUG_KEY)).toBe(JSON.stringify(payload));
    setWidgetDebugIdentity(null);
  });
});

describe("iOS widget bridge", () => {
  function nativeBridge() {
    const plugin: NativeWidgetPlugin = {
      writeWidget: vi.fn(async () => undefined),
      clearWidget: vi.fn(async () => undefined),
    };
    return { plugin, ...createDeviceBridge("ios", plugin) };
  }

  it("sends the exact payload JSON to the native plugin, not localStorage", async () => {
    const storage = stubStorage();
    const { plugin, device: ios, setWidgetDebugIdentity: setIdentity } = nativeBridge();
    expect(ios.platform).toBe("ios");
    expect(ios.isNative).toBe(true);
    setIdentity("a");
    await ios.syncWidget(payload, "a");
    expect(plugin.clearWidget).toHaveBeenCalledOnce();
    expect(plugin.writeWidget).toHaveBeenCalledWith({ json: JSON.stringify(payload) });
    expect(storage.has(DEBUG_KEY)).toBe(false);
  });

  it("falls back to v1 only when an older native host rejects v2 keys", async () => {
    stubStorage();
    const { plugin, device: ios, setWidgetDebugIdentity: setIdentity } = nativeBridge();
    const v2: WidgetPayload = {
      ...payload,
      schemaVersion: 2,
      routineWeek: Array.from({ length: 7 }, (_, weekday) => ({ weekday, label: null, exercises: [] })),
    };
    vi.mocked(plugin.writeWidget).mockRejectedValueOnce(
      Object.assign(new Error("Invalid WidgetPayload"), { code: "INVALID_PAYLOAD" }),
    );
    setIdentity("a");
    await ios.syncWidget(v2, "a");
    expect(plugin.writeWidget).toHaveBeenNthCalledWith(1, { json: JSON.stringify(v2) });
    expect(plugin.writeWidget).toHaveBeenNthCalledWith(2, { json: JSON.stringify(payload) });
  });

  it("serializes clears with writes and rejects a queued old-account write", async () => {
    stubStorage();
    let release!: () => void;
    const firstClear = new Promise<void>((resolve) => { release = resolve; });
    const plugin: NativeWidgetPlugin = {
      writeWidget: vi.fn(async () => undefined),
      clearWidget: vi.fn().mockReturnValueOnce(firstClear).mockResolvedValue(undefined),
    };
    const { device: ios, setWidgetDebugIdentity: setIdentity } = createDeviceBridge("ios", plugin);
    setIdentity("a");
    const stale = ios.syncWidget(payload, "a");
    setIdentity("b");
    release();
    await stale;
    await ios.syncWidget(payload, "b");
    expect(plugin.clearWidget).toHaveBeenCalledTimes(2);
    expect(plugin.writeWidget).toHaveBeenCalledTimes(1);
  });

  it("propagates native write failures and reports an unavailable plugin", async () => {
    stubStorage();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { plugin, device: ios, setWidgetDebugIdentity: setIdentity } = nativeBridge();
    setIdentity("a");
    vi.mocked(plugin.writeWidget).mockRejectedValueOnce(new Error("APP_GROUP_UNAVAILABLE"));
    await expect(ios.syncWidget(payload, "a")).rejects.toThrow("APP_GROUP_UNAVAILABLE");
    expect(log).toHaveBeenCalledWith("Could not sync shared widget data", expect.any(Error));
    await expect(ios.syncWidget(payload, "a")).resolves.toBeUndefined();

    const missing = createDeviceBridge("ios");
    missing.setWidgetDebugIdentity("a");
    await expect(missing.device.syncWidget(payload, "a")).rejects.toThrow("plugin unavailable");
    log.mockRestore();
  });
});

describe("activity bridge", () => {
  const reminder: Reminder = { id: "workout", title: "Train", body: "Go", at: "18:00", weekdays: [1, 3, 5] };
  function nativeBridge() {
    const plugin: NativeActivityPlugin = {
      setOwner: vi.fn(async () => undefined),
      scheduleReminder: vi.fn(async () => ({ scheduled: true })),
      cancelReminder: vi.fn(async () => undefined),
      getReminder: vi.fn(async () => ({ reminder })),
      getStepsToday: vi.fn(async () => ({ steps: 1234 })),
    };
    return { plugin, ...createDeviceBridge("ios", undefined, plugin) };
  }

  it("keeps the browser fallback inert", async () => {
    const { device: web, setReminderIdentity } = createDeviceBridge("web");
    setReminderIdentity("a");
    await expect(web.scheduleReminder(reminder)).resolves.toBe(false);
    await expect(web.cancelReminder(reminder.id)).resolves.toBeUndefined();
    await expect(web.getReminder()).resolves.toBeNull();
    await expect(web.getStepsToday()).resolves.toBeNull();
  });

  it("serializes owner confirmation before scheduling and reads current steps", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    setReminderIdentity("a");
    await expect(ios.scheduleReminder(reminder)).resolves.toBe(true);
    expect(plugin.setOwner).toHaveBeenCalledWith({ ownerId: "a" });
    expect(plugin.scheduleReminder).toHaveBeenCalledWith({ reminder });
    await expect(ios.getReminder()).resolves.toEqual(reminder);
    await expect(ios.getStepsToday()).resolves.toBe(1234);
    await ios.cancelReminder("workout");
    expect(plugin.cancelReminder).toHaveBeenCalledWith({ id: "workout" });
  });

  it("drops a queued previous-account operation and clears on sign-out", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    let release!: () => void;
    vi.mocked(plugin.setOwner).mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    setReminderIdentity("a");
    const stale = ios.scheduleReminder(reminder);
    setReminderIdentity("b");
    release();
    await expect(stale).resolves.toBe(false);
    await ios.getReminder();
    expect(plugin.scheduleReminder).not.toHaveBeenCalled();
    expect(plugin.setOwner).toHaveBeenCalledWith({ ownerId: "b" });
    setReminderIdentity(null);
    await expect(ios.getReminder()).resolves.toBeNull();
    await expect(ios.scheduleReminder(reminder)).rejects.toThrow("identity unavailable");
    // Flush the queued native sign-out too.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(plugin.setOwner).toHaveBeenCalledWith({ ownerId: null });
  });

  it("passes denial through as false and reports missing native activity plugin", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    vi.mocked(plugin.scheduleReminder).mockResolvedValueOnce({ scheduled: false });
    setReminderIdentity("a");
    await expect(ios.scheduleReminder(reminder)).resolves.toBe(false);
    vi.mocked(plugin.getStepsToday).mockResolvedValueOnce({ steps: null });
    await expect(ios.getStepsToday()).resolves.toBeNull();

    const missing = createDeviceBridge("ios");
    missing.setReminderIdentity("a");
    await expect(missing.device.scheduleReminder(reminder)).rejects.toThrow("plugin unavailable");
    await expect(missing.device.getStepsToday()).rejects.toThrow("plugin unavailable");
  });

  it("does not schedule against a stale native owner when owner synchronization fails", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(plugin.setOwner).mockRejectedValueOnce(new Error("OWNER_FAILED"));
    setReminderIdentity("a");
    await expect(ios.scheduleReminder(reminder)).rejects.toThrow("not synchronized");
    expect(plugin.scheduleReminder).not.toHaveBeenCalled();
    setReminderIdentity("a"); // An auth retry can repair the native identity.
    await expect(ios.scheduleReminder(reminder)).resolves.toBe(true);
    log.mockRestore();
  });

  it("waits for account confirmation before steps and prompts only on an explicit request", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    let confirm!: () => void;
    vi.mocked(plugin.setOwner).mockReturnValueOnce(new Promise<void>((resolve) => { confirm = resolve; }));
    setReminderIdentity("a");
    const pending = ios.getStepsToday();
    await Promise.resolve();
    expect(plugin.getStepsToday).not.toHaveBeenCalled();
    confirm();
    await expect(pending).resolves.toBe(1234);
    expect(plugin.getStepsToday).toHaveBeenLastCalledWith({ requestPermission: false });
    await ios.getStepsToday({ requestPermission: true });
    expect(plugin.getStepsToday).toHaveBeenLastCalledWith({ requestPermission: true });
  });

  it("drops an in-flight steps reply across account switches, even when returning to the original owner", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    setReminderIdentity("a");
    await ios.getReminder();
    let finish!: (result: { steps: number | null }) => void;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(plugin.getStepsToday).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = ios.getStepsToday();
    await didStart;
    setReminderIdentity("b");
    setReminderIdentity("a");
    finish({ steps: 9876 });
    await expect(pending).resolves.toBeNull();
    await ios.getReminder();
    expect(plugin.setOwner).toHaveBeenLastCalledWith({ ownerId: "a" });
  });

  it("keeps a real zero distinct from unavailable or invalid sensor data", async () => {
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    setReminderIdentity("a");
    for (const steps of [0, null, -1, 1.5, Number.NaN]) {
      vi.mocked(plugin.getStepsToday).mockResolvedValueOnce({ steps });
      await expect(ios.getStepsToday()).resolves.toBe(steps === 0 ? 0 : null);
    }
  });

  it("never accepts a reading from yesterday or a request that crosses local midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 50));
    const { plugin, device: ios, setReminderIdentity } = nativeBridge();
    setReminderIdentity("a");
    vi.mocked(plugin.getStepsToday).mockResolvedValueOnce({ steps: 1234, dayKey: "2026-10-08" });
    await expect(ios.getStepsToday()).resolves.toBeNull();
    let finish!: (result: { steps: number | null }) => void;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(plugin.getStepsToday).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = ios.getStepsToday();
    await didStart;
    vi.setSystemTime(new Date(2026, 9, 10, 0, 0, 1));
    finish({ steps: 1234 });
    await expect(pending).resolves.toBeNull();
    vi.mocked(plugin.getStepsToday).mockResolvedValueOnce({ steps: 0, dayKey: "2026-10-10" });
    await expect(ios.getStepsToday()).resolves.toBe(0);
  });
});

describe("sign-out device cleanup", () => {
  function nativeBridge() {
    const events: string[] = [];
    const widget: NativeWidgetPlugin = {
      writeWidget: vi.fn(async () => { events.push("write"); }),
      clearWidget: vi.fn(async () => { events.push("clear widget"); }),
    };
    const activity: NativeActivityPlugin = {
      setOwner: vi.fn(async ({ ownerId }) => { events.push(`owner ${ownerId}`); }),
      scheduleReminder: vi.fn(async () => ({ scheduled: true })),
      cancelReminder: vi.fn(async () => undefined),
      getReminder: vi.fn(async () => ({ reminder: null })),
      getStepsToday: vi.fn(async () => ({ steps: null })),
    };
    return { events, widget, activity, ...createDeviceBridge("ios", widget, activity) };
  }

  it("waits for queued writes and both native removals before signing out", async () => {
    stubStorage();
    const bridge = nativeBridge();
    bridge.setWidgetDebugIdentity("a");
    bridge.setReminderIdentity("a");
    await bridge.device.syncWidget(payload, "a");
    let releaseWrite!: () => void;
    const inFlightWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    vi.mocked(bridge.widget.writeWidget).mockImplementationOnce(async () => {
      bridge.events.push("late write");
      await inFlightWrite;
    });
    const writing = bridge.device.syncWidget(payload, "a");
    await vi.waitFor(() => expect(bridge.events).toContain("late write"));
    let releaseOwner!: () => void;
    const inFlightOwner = new Promise<void>((resolve) => { releaseOwner = resolve; });
    vi.mocked(bridge.activity.setOwner).mockImplementationOnce(async ({ ownerId }) => {
      bridge.events.push(`owner ${ownerId}`);
      await inFlightOwner;
    });
    const signOut = vi.fn(async () => { bridge.events.push("sign out"); });
    const pending = signOutAfterDeviceCleanup(bridge.device, signOut);
    expect(signOut).not.toHaveBeenCalled();
    releaseWrite();
    await writing;
    await vi.waitFor(() => expect(bridge.activity.setOwner).toHaveBeenCalledWith({ ownerId: null }));
    expect(bridge.events.slice(-2)).toEqual(["clear widget", "owner null"]);
    expect(signOut).not.toHaveBeenCalled();
    releaseOwner();
    await pending;
    expect(bridge.events.slice(-3)).toEqual(["clear widget", "owner null", "sign out"]);
  });

  it("keeps auth signed in if either native removal fails, and allows retry", async () => {
    stubStorage();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bridge = nativeBridge();
    bridge.setWidgetDebugIdentity("a");
    bridge.setReminderIdentity("a");
    await bridge.device.syncWidget(payload, "a");
    vi.mocked(bridge.widget.clearWidget).mockRejectedValueOnce(new Error("WIDGET_CLEAR_FAILED"));
    vi.mocked(bridge.activity.setOwner).mockRejectedValueOnce(new Error("REMINDER_CLEAR_FAILED"));
    const signOut = vi.fn(async () => undefined);
    await expect(signOutAfterDeviceCleanup(bridge.device, signOut))
      .rejects.toThrow(/WIDGET_CLEAR_FAILED.*REMINDER_CLEAR_FAILED/);
    expect(signOut).not.toHaveBeenCalled();
    expect(bridge.widget.clearWidget).toHaveBeenCalledTimes(2);
    expect(bridge.activity.setOwner).toHaveBeenCalledWith({ ownerId: null });
    await signOutAfterDeviceCleanup(bridge.device, signOut);
    expect(signOut).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("blocks native sign-out when a required plugin is unavailable", async () => {
    stubStorage();
    const bridge = createDeviceBridge("ios");
    const signOut = vi.fn(async () => undefined);
    await expect(signOutAfterDeviceCleanup(bridge.device, signOut)).rejects.toThrow("F1tWidget native plugin unavailable");
    expect(signOut).not.toHaveBeenCalled();
  });
});
