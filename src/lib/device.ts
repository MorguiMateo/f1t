/**
 * All device access goes through here so wrapping the app in Capacitor means
 * adding a native implementation, not touching screens.
 */

export type Platform = "web" | "ios" | "android";

/** Serialised to the App Group for the iOS widget. */
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
  syncWidget(payload: WidgetPayload): Promise<void>;

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

const webBridge: DeviceBridge = {
  platform: "web",
  isNative: false,

  async syncWidget(payload) {
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
