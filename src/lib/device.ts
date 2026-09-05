/**
 * Todo lo que toca el dispositivo pasa por acá.
 *
 * Hoy hay una sola implementación, la web, y casi todo es no-op. Cuando la
 * app se envuelva en Capacitor se agrega la implementación nativa acá abajo
 * y **ninguna pantalla cambia**: las features siguen llamando a `device.*`.
 *
 * Es la pieza que hace que pasar a nativo sea agregar un archivo y no
 * reescribir la app.
 */

export type Platform = "web" | "ios" | "android";

/** Lo que el widget de iOS necesita saber. Se serializa al App Group. */
export type WidgetPayload = {
  /** Salida de buildLevels(): enteros 0–4, longitud weeks * 7. */
  levels: number[];
  /** Nombre del día de rutina que toca hoy, o null si es descanso. */
  todayLabel: string | null;
  /** Primeros ejercicios de hoy, para el widget grande. */
  todayExercises: { name: string; detail: string }[];
  streak: number;
};

export type Reminder = {
  id: string;
  title: string;
  body: string;
  /** Hora local en formato HH:mm. */
  at: string;
  /** Días de la semana en que se repite. 0 = domingo. */
  weekdays: number[];
};

export interface DeviceBridge {
  readonly platform: Platform;
  readonly isNative: boolean;

  /**
   * Publica el estado donde el widget lo pueda leer.
   * En web no hay widget, así que solo deja rastro para poder depurar el
   * payload antes de que exista el lado nativo.
   */
  syncWidget(payload: WidgetPayload): Promise<void>;

  /**
   * Programa un recordatorio local recurrente.
   * Devuelve false si la plataforma no puede hacerlo. En web no se puede:
   * la API de Notifications no tiene triggers, haría falta push desde el
   * servidor. En iOS nativo es UNUserNotificationCenter y sale gratis.
   */
  scheduleReminder(reminder: Reminder): Promise<boolean>;

  cancelReminder(id: string): Promise<void>;

  /**
   * Pasos de hoy. En web no hay fuente confiable —el acelerómetro solo
   * corre en primer plano— así que devuelve null. En iOS nativo sale de
   * CMPedometer, que no necesita HealthKit ni cuenta paga.
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
      // Modo privado o storage bloqueado. No es crítico: en web nadie lee esto.
    }
  },

  async scheduleReminder() {
    return false;
  },

  async cancelReminder() {
    // No hay nada agendado que cancelar.
  },

  async getStepsToday() {
    return null;
  },
};

/**
 * Cuando exista el shell nativo, esto pasa a elegir implementación según
 * `Capacitor.getPlatform()`. Por ahora siempre es la web.
 */
export const device: DeviceBridge = webBridge;
