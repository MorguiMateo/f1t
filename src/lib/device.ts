/**
 * All device access goes through here so wrapping the app in Capacitor means
 * adding a native implementation, not touching screens.
 */

export type Platform = "web" | "ios" | "android";

/**
 * Stored in localStorage on the web; intended for the future iOS widget's App
 * Group. Weight is omitted until a widget needs it. Swift's `JSONDecoder`
 * ignores unknown keys, so a future field can be added compatibly.
 */
export type WidgetPayload = {
  /** Output of buildLevels(). */
  levels: number[];
  /** Null on a rest day. */
  todayLabel: string | null;
  todayExercises: { name: string; detail: string }[];
  streak: number;
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

  /** On the web there is no widget; the payload is only stored for debugging. */
  syncWidget(payload: WidgetPayload, ownerId: string): Promise<void>;

  /**
   * Returns false on the web: the Notifications API has no triggers, so it
   * would take server push.
   */
  scheduleReminder(reminder: Reminder): Promise<boolean>;

  cancelReminder(id: string): Promise<void>;

  /**
   * Null on the web: the accelerometer only runs in the foreground. On iOS
   * CMPedometer needs neither HealthKit nor a paid account.
   */
  getStepsToday(): Promise<number | null>;
}

const WIDGET_DEBUG_KEY = "f1t:widget-payload";
let widgetDebugOwner: string | null = null;
let widgetDebugOwnerInitialized = false;

/** Invalidate the unscoped debug copy before a new account can see it. */
export function setWidgetDebugIdentity(userId: string | null): void {
  if (widgetDebugOwnerInitialized && widgetDebugOwner === userId) return;
  widgetDebugOwnerInitialized = true;
  widgetDebugOwner = userId;
  try {
    localStorage.removeItem(WIDGET_DEBUG_KEY);
  } catch {
    // Private mode or blocked storage; nothing reads this on the web.
  }
}

const webBridge: DeviceBridge = {
  platform: "web",
  isNative: false,

  async syncWidget(payload, ownerId) {
    // A stale effect may finish after auth switches; it must not restore old data.
    if (!ownerId || ownerId !== widgetDebugOwner) return;
    try {
      localStorage.setItem(WIDGET_DEBUG_KEY, JSON.stringify(payload));
    } catch {
      // Private mode or blocked storage; nothing reads this on the web.
    }
  },

  async scheduleReminder() {
    return false;
  },

  async cancelReminder() {
    // Nothing scheduled to cancel.
  },

  async getStepsToday() {
    return null;
  },
};

export const device: DeviceBridge = webBridge;
