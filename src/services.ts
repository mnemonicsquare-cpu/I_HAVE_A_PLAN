import { type Data } from "./domain";
import { store } from "./storage";
export class ReminderService {
  private running = false;
  async check(
    data: Data,
    now: number,
    onReminder: (ids: string[], late: boolean) => void,
  ) {
    if (this.running || document.visibilityState !== "visible") return;
    this.running = true;
    try {
      const current = await store.claimDue(now);
      if (!current.length) return;
      onReminder(
        current.map((e) => e.taskId),
        current.some((e) => e.late),
      );
      if ("Notification" in window && Notification.permission === "granted") {
        const title =
          data.settings.privateNotifications || current.length > 1
            ? "Есть запланированное дело"
            : (data.tasks.find((t) => t.id === current[0].taskId)?.title ??
              "Есть запланированное дело");
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          if (reg)
            await reg.showNotification(title, {
              tag: "seychas-reminder",
              icon: `${import.meta.env.BASE_URL}icon-192.png`,
            });
          else new Notification(title, { tag: "seychas-reminder" });
        } catch {
          /* In-app delivery remains available. */
        }
      }
    } finally {
      this.running = false;
    }
  }
}
export async function enableNotifications() {
  if (!("Notification" in window))
    return "Этот браузер не поддерживает системные уведомления";
  if (Notification.permission === "denied")
    return "Уведомления отключены в настройках браузера. Карточки в приложении работают";
  const permission = await Notification.requestPermission();
  return permission === "granted"
    ? "Системные уведомления включены"
    : "Карточки напоминаний в приложении остаются доступны";
}
export function chime(enabled: boolean) {
  if (!enabled) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => void ctx.close();
  } catch {
    /* Audio never blocks saving. */
  }
}
