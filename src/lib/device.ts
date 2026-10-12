/** All device access is isolated here; screens do not know about Capacitor. */
import { Capacitor, registerPlugin } from "@capacitor/core";

export type Platform = "web" | "ios" | "android";
export type StepsReadOptions = { requestPermission?: boolean };

/** Exact JSON schema consumed by the iOS widget; weight has no widget consumer. */
export type WidgetPayload = {
  /** Output of buildLevels(): 26 weeks, oldest to newest, values 0–4. */
  levels: number[];
  /** Null on a rest day. */
  todayLabel: string | null;
  todayExercises: { name: string; detail: string }[];
  streak: number;
  /** v2 uses a recurring local-week schedule; v1 readers ignore these keys. */
  schemaVersion?: 2;
  routineWeek?: {
    weekday: number;
    label: string | null;
    exercises: { name: string; detail: string }[];
  }[];
};

export type Reminder = {
  id: string;
  title: string;
  body: string;
  /** Local time, HH:mm. */
  at: string;
  /** 0 = Sunday. */
  weekdays: number[];
};

export interface DeviceBridge {
  readonly platform: Platform;
  readonly isNative: boolean;
  /** Blocks sign-out until both native stores have removed private data. */
  clearPrivateData(): Promise<void>;
  syncWidget(payload: WidgetPayload, ownerId: string): Promise<void>;
  scheduleReminder(reminder: Reminder): Promise<boolean>;
  cancelReminder(id: string): Promise<void>;
  getReminder(): Promise<Reminder | null>;
  getStepsToday(options?: StepsReadOptions): Promise<number | null>;
}

/** Never start the auth transition until native private data is gone. */
export async function signOutAfterDeviceCleanup<T>(
  bridge: Pick<DeviceBridge, "clearPrivateData">,
  signOut: () => Promise<T>,
): Promise<T> {
  await bridge.clearPrivateData();
  return signOut();
}

/** Native plugin contract. Kept injectable so platform and failure paths are testable. */
export interface NativeWidgetPlugin {
  writeWidget(options: { json: string }): Promise<void>;
  clearWidget(): Promise<void>;
}

export interface NativeActivityPlugin {
  setOwner(options: { ownerId: string | null }): Promise<void>;
  scheduleReminder(options: { reminder: Reminder }): Promise<{ scheduled: boolean }>;
  cancelReminder(options: { id: string }): Promise<void>;
  getReminder(): Promise<{ reminder: Reminder | null }>;
  getStepsToday(options?: StepsReadOptions): Promise<{
    steps: number | null;
    /** New native hosts return the device-local date; older hosts omit it. */
    dayKey?: string;
  }>;
}

const WIDGET_DEBUG_KEY = "f1t:widget-payload";

function isInvalidWidgetPayload(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "INVALID_PAYLOAD";
}

export function createDeviceBridge(platform: Platform, nativeWidget?: NativeWidgetPlugin, nativeActivity?: NativeActivityPlugin): {
  device: DeviceBridge;
  setWidgetDebugIdentity: (userId: string | null) => void;
  setReminderIdentity: (userId: string | null) => void;
} {
  let owner: string | null = null;
  let initialized = false;
  let reminderOwner: string | null = null;
  let reminderIdentityConfirmed = false;
  let nativeReminderOwner: string | null | undefined;
  let activityIdentityRevision = 0;
  // Native operations must finish in auth order. In particular, a stale write
  // cannot complete after a sign-out clear.
  let nativeQueue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = nativeQueue.then(operation);
    nativeQueue = result.catch(() => undefined);
    return result;
  }

  function setWidgetDebugIdentity(userId: string | null): void {
    if (initialized && owner === userId) return;
    initialized = true;
    owner = userId;
    try {
      localStorage.removeItem(WIDGET_DEBUG_KEY);
    } catch {
      // Private mode or blocked storage; only a diagnostic copy lives here.
    }
    if (platform === "ios" && nativeWidget) {
      // This API is synchronous for the existing auth caller. Surface a clear
      // failure to the console instead of allowing an unhandled rejection.
      void enqueue(() => nativeWidget.clearWidget()).catch((error: unknown) => {
        console.error("Could not clear shared widget data", error);
      });
    }
  }

  // Called only after auth resolves, unlike the widget's eager diagnostic clear.
  // Native owns the persisted schedule and removes it before another account acts.
  function setReminderIdentity(userId: string | null): void {
    if (reminderIdentityConfirmed && reminderOwner === userId && nativeReminderOwner === userId) return;
    reminderIdentityConfirmed = true;
    activityIdentityRevision++;
    reminderOwner = userId;
    nativeReminderOwner = undefined;
    if (platform === "ios" && nativeActivity) {
      void enqueue(async () => {
        await nativeActivity.setOwner({ ownerId: userId });
        if (reminderOwner === userId) nativeReminderOwner = userId;
      }).catch((error: unknown) => {
        console.error("Could not update reminder owner", error);
      });
    }
  }

  const device: DeviceBridge = {
    platform: platform === "ios" ? "ios" : "web",
    isNative: platform === "ios",
    clearPrivateData() {
      // Invalidate pending writes/schedules immediately. The queued cleanup
      // runs after any native operation already in flight, before sign-out.
      initialized = true;
      owner = null;
      reminderIdentityConfirmed = true;
      activityIdentityRevision++;
      reminderOwner = null;
      nativeReminderOwner = undefined;
      try {
        localStorage.removeItem(WIDGET_DEBUG_KEY);
      } catch {
        // Diagnostic copy only; blocked storage cannot retain one.
      }
      if (platform !== "ios") return Promise.resolve();
      return enqueue(async () => {
        const failures: unknown[] = [];
        try {
          if (!nativeWidget) throw new Error("F1tWidget native plugin unavailable");
          await nativeWidget.clearWidget();
        } catch (error) {
          failures.push(error);
        }
        try {
          if (!nativeActivity) throw new Error("F1tActivity native plugin unavailable");
          await nativeActivity.setOwner({ ownerId: null });
          nativeReminderOwner = null;
        } catch (error) {
          failures.push(error);
        }
        if (failures.length) {
          const details = failures.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
          throw new AggregateError(failures, `No se pudieron borrar los datos privados del dispositivo: ${details}`);
        }
      });
    },
    syncWidget(payload, ownerId) {
      if (!ownerId || ownerId !== owner) return Promise.resolve();
      const json = JSON.stringify(payload);
      if (platform === "ios") {
        if (!nativeWidget) return Promise.reject(new Error("F1tWidget native plugin unavailable"));
        const pending = enqueue(async () => {
          if (ownerId !== owner) return;
          try {
            await nativeWidget.writeWidget({ json });
          } catch (error) {
            // An older installed native host accepts exactly the v1 keys.
            // PWA/web code can update before that host does, so degrade to a
            // same-day payload rather than losing widget sync altogether.
            if (payload.schemaVersion !== 2 || !isInvalidWidgetPayload(error)) throw error;
            if (ownerId !== owner) return;
            const { schemaVersion: _version, routineWeek: _week, ...legacy } = payload;
            await nativeWidget.writeWidget({ json: JSON.stringify(legacy) });
          }
        });
        // WidgetSync intentionally fire-and-forgets. Attach a rejection handler
        // without hiding the failure from callers that await this promise.
        void pending.catch((error: unknown) => {
          console.error("Could not sync shared widget data", error);
        });
        return pending;
      } else {
        try {
          localStorage.setItem(WIDGET_DEBUG_KEY, json);
        } catch {
          // The web widget copy is diagnostic only.
        }
        return Promise.resolve();
      }
    },
    scheduleReminder(reminder) {
      if (platform !== "ios") return Promise.resolve(false);
      if (!nativeActivity) return Promise.reject(new Error("F1tActivity native plugin unavailable"));
      if (!reminderIdentityConfirmed || !reminderOwner) return Promise.reject(new Error("Reminder identity unavailable"));
      const requestOwner = reminderOwner;
      return enqueue(async () => {
        if (reminderOwner !== requestOwner) return false;
        if (nativeReminderOwner !== requestOwner) throw new Error("Reminder identity not synchronized");
        return (await nativeActivity.scheduleReminder({ reminder })).scheduled;
      });
    },
    cancelReminder(id) {
      if (platform !== "ios" || !nativeActivity || !reminderOwner) return Promise.resolve();
      const requestOwner = reminderOwner;
      return enqueue(async () => {
        if (reminderOwner === requestOwner) {
          if (nativeReminderOwner !== requestOwner) throw new Error("Reminder identity not synchronized");
          await nativeActivity.cancelReminder({ id });
        }
      });
    },
    getReminder() {
      if (platform !== "ios" || !nativeActivity || !reminderOwner) return Promise.resolve(null);
      const requestOwner = reminderOwner;
      return enqueue(async () => {
        if (reminderOwner !== requestOwner) return null;
        if (nativeReminderOwner !== requestOwner) throw new Error("Reminder identity not synchronized");
        return (await nativeActivity.getReminder()).reminder;
      });
    },
    getStepsToday(options = { requestPermission: false }) {
      if (platform !== "ios") return Promise.resolve(null);
      if (!nativeActivity) return Promise.reject(new Error("F1tActivity native plugin unavailable"));
      if (!reminderOwner) return Promise.resolve(null);
      const requestOwner = reminderOwner;
      const requestRevision = activityIdentityRevision;
      const dayKey = () => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      };
      const requestDay = dayKey();
      return enqueue(async () => {
        if (reminderOwner !== requestOwner || activityIdentityRevision !== requestRevision) return null;
        if (nativeReminderOwner !== requestOwner) throw new Error("Activity identity not synchronized");
        const result = await nativeActivity.getStepsToday(options);
        if (reminderOwner !== requestOwner || activityIdentityRevision !== requestRevision || dayKey() !== requestDay ||
            (result.dayKey !== undefined && result.dayKey !== requestDay)) return null;
        // Zero is a valid authorized reading, never a fallback for missing data.
        return result.steps !== null && Number.isSafeInteger(result.steps) && result.steps >= 0
          ? result.steps : null;
      });
    },
  };

  return { device, setWidgetDebugIdentity, setReminderIdentity };
}

const selected = createDeviceBridge(
  Capacitor.getPlatform() === "ios" ? "ios" : "web",
  registerPlugin<NativeWidgetPlugin>("F1tWidget"),
  registerPlugin<NativeActivityPlugin>("F1tActivity"),
);

export const device = selected.device;
export const setWidgetDebugIdentity = selected.setWidgetDebugIdentity;
export const setReminderIdentity = selected.setReminderIdentity;
