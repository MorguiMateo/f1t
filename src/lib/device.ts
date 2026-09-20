/**
 * Everything that touches the device goes through here.
 *
 * Today there is one implementation, the web one, and almost all of it is a
 * no-op. When the app gets wrapped in Capacitor the native implementation
 * gets added below and **no screen changes**: features keep calling
 * `device.*`.
 *
 * This is the piece that makes going native a matter of adding a file rather
 * than rewriting the app.
 */

export type Platform = "web" | "ios" | "android";

/** What the iOS widget needs to know. Serialised to the App Group. */
export type WidgetPayload = {
  /** Output of buildLevels(): integers 0–4, length weeks * 7. */
  levels: number[];
  /** Name of the routine day that's on today, or null on a rest day. */
  todayLabel: string | null;
  /** Today's first exercises, for the large widget. */
  todayExercises: { name: string; detail: string }[];
  streak: number;
};

export type Reminder = {
  id: string;
  title: string;
  body: string;
  /** Local time in HH:mm format. */
  at: string;
  /** Weekdays it repeats on. 0 = Sunday. */
  weekdays: number[];
};

export interface DeviceBridge {
  readonly platform: Platform;
  readonly isNative: boolean;

  /**
   * Publishes state somewhere the widget can read it.
   * On the web there is no widget, so this only leaves a trace so the
   * payload can be debugged before the native side exists.
   */
  syncWidget(payload: WidgetPayload): Promise<void>;

  /**
   * Schedules a recurring local reminder.
   * Returns false if the platform can't do it. The web can't: the
   * Notifications API has no triggers, it would take server push. On native
   * iOS it is UNUserNotificationCenter and it comes for free.
   */
  scheduleReminder(reminder: Reminder): Promise<boolean>;

  cancelReminder(id: string): Promise<void>;

  /**
   * Today's step count. On the web there is no reliable source — the
   * accelerometer only runs in the foreground — so it returns null. On
   * native iOS it comes from CMPedometer, which needs neither HealthKit nor
   * a paid account.
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
      // Private mode or storage blocked. Not critical: on the web nobody
      // reads this.
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

/**
 * Once the native shell exists, this picks an implementation based on
 * `Capacitor.getPlatform()`. For now it is always the web.
 */
export const device: DeviceBridge = webBridge;
