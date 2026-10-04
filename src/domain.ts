import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const localDate = (now: number, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
export const localTime = (now: number, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .toPlainTime()
    .toString()
    .slice(0, 5);
export const addDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
export const at = (date: string, time: string, zone: string) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: "compatible",
  }).epochMilliseconds;
const validDate = (s: string) => {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Temporal.PlainDate.from(s).toString() === s
    );
  } catch {
    return false;
  }
};
const validZone = (s: string) => {
  try {
    new Intl.DateTimeFormat("ru", { timeZone: s });
    return true;
  } catch {
    return false;
  }
};
const date = z.string().refine(validDate, "Проверьте дату");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Проверьте время");
const zone = z.string().max(100).refine(validZone, "Неизвестный часовой пояс");
const stamp = z.number().int().min(0).max(8640000000000000);
const id = z.string().min(1).max(150);
const stepSchema = z
  .object({ id, title: z.string().trim().min(1).max(500), done: z.boolean() })
  .strict();
const fields = {
  title: z
    .string()
    .trim()
    .min(1, "Введите название")
    .max(500, "Название — до 500 символов"),
  note: z.string().max(10000),
  date: date.nullable(),
  time: time.nullable(),
  zone,
  duration: z.number().int().min(1).max(720).nullable(),
  important: z.boolean(),
  fixed: z.boolean(),
  reminder: z.enum(["off", "at", "before", "repeat"]),
  steps: z.array(stepSchema).max(100),
};
export const taskSchema = z
  .object({
    ...fields,
    id,
    ruleId: id.nullable(),
    occurrenceDate: date.nullable(),
    status: z.enum(["planned", "active", "paused", "done", "cancelled"]),
    createdAt: stamp,
    updatedAt: stamp,
    startedAt: stamp.nullable(),
    elapsedMs: z.number().min(0).max(1e15),
    completedAt: stamp.nullable(),
    snoozeUntil: stamp.nullable(),
    deleted: z.boolean().optional(),
  })
  .strict()
  .superRefine((t, c) => {
    if (t.deleted && t.status !== "cancelled")
      c.addIssue({
        code: "custom",
        message: "Удалённый экземпляр не может быть активным",
      });
    if (t.time && !t.date)
      c.addIssue({ code: "custom", message: "Для времени нужна дата" });
    if (t.fixed && (!t.date || !t.time))
      c.addIssue({
        code: "custom",
        message: "Для закрепления нужны дата и время",
      });
    if (t.reminder !== "off" && (!t.date || !t.time))
      c.addIssue({
        code: "custom",
        message: "Для напоминания нужны дата и время",
      });
    if ((t.status === "active") !== (t.startedAt !== null))
      c.addIssue({ code: "custom", message: "Некорректное состояние таймера" });
    if ((t.status === "done") !== (t.completedAt !== null))
      c.addIssue({ code: "custom", message: "Некорректное завершение" });
    if (new Set(t.steps.map((s) => s.id)).size !== t.steps.length)
      c.addIssue({ code: "custom", message: "Повторяются шаги" });
  });
const ruleSchema = z
  .object({
    ...fields,
    id: id.max(100),
    kind: z.enum(["daily", "weekdays", "weekly", "custom"]),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start: date,
    enabled: z.boolean(),
  })
  .strict();
export const settingsSchema = z
  .object({
    zone,
    end: time,
    buffer: z.number().int().min(0).max(60),
    unknownDuration: z.number().int().min(1).max(120),
    capacity: z.number().min(0.1).max(1),
    beforeMinutes: z.number().int().min(1).max(60),
    repeatMinutes: z.number().int().min(1).max(60),
    fox: z.boolean(),
    effects: z.boolean(),
    sound: z.boolean(),
    timer: z.boolean(),
    reduceMotion: z.boolean(),
    privateNotifications: z.boolean(),
    onboarded: z.boolean(),
  })
  .strict();
export const dataSchema = z
  .object({
    schemaVersion: z.literal(1),
    tasks: z.array(taskSchema).max(10000),
    rules: z.array(ruleSchema).max(1000),
    settings: settingsSchema,
    selectedId: id.nullable(),
    rewards: z
      .array(z.object({ key: z.string().min(1).max(400), at: stamp }).strict())
      .max(100000),
  })
  .strict()
  .superRefine((d, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (new TextEncoder().encode(JSON.stringify(d)).length > 5_000_000)
      fail(
        "База достигла предела 5 МБ. Скачайте копию и удалите ненужные дела перед добавлением новых",
      );
    if (new Set(d.tasks.map((t) => t.id)).size !== d.tasks.length)
      fail("Повторяются дела");
    if (new Set(d.rules.map((r) => r.id)).size !== d.rules.length)
      fail("Повторяются серии");
    if (new Set(d.rewards.map((r) => r.key)).size !== d.rewards.length)
      fail("Повторяются награды");
    if (d.tasks.filter((t) => t.status === "active").length > 1)
      fail("Больше одного активного дела");
    if (d.selectedId && !d.tasks.some((t) => t.id === d.selectedId))
      fail("Выбранное дело не найдено");
    const occurrences = new Set<string>();
    for (const t of d.tasks) {
      if (t.ruleId) {
        const key = `${t.ruleId}:${t.occurrenceDate}`;
        if (
          !d.rules.some((r) => r.id === t.ruleId) ||
          !t.occurrenceDate ||
          occurrences.has(key)
        )
          fail("Неверная связь повторения");
        occurrences.add(key);
      } else if (t.occurrenceDate) fail("Нет правила повторения");
    }
    for (const r of d.rules) {
      if (new Set(r.steps.map((s) => s.id)).size !== r.steps.length)
        fail("Повторяются шаги в серии");
      if (
        (r.time && !r.date) ||
        (r.fixed && !r.time) ||
        (r.reminder !== "off" && !r.time)
      )
        fail("Неверное время серии");
    }
  });
export type Task = z.infer<typeof taskSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Data = z.infer<typeof dataSchema>;
export const initialData = (
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Data => ({
  schemaVersion: 1,
  tasks: [],
  rules: [],
  selectedId: null,
  rewards: [],
  settings: {
    zone,
    end: "21:00",
    buffer: 5,
    unknownDuration: 15,
    capacity: 0.7,
    beforeMinutes: 5,
    repeatMinutes: 5,
    fox: true,
    effects: true,
    sound: false,
    timer: true,
    reduceMotion: false,
    privateNotifications: true,
    onboarded: false,
  },
});
export const makeTask = (
  title: string,
  now: number,
  zone: string,
  id: string = crypto.randomUUID(),
): Task => ({
  id,
  title,
  note: "",
  date: null,
  time: null,
  zone,
  duration: null,
  important: false,
  fixed: false,
  reminder: "off",
  steps: [],
  ruleId: null,
  occurrenceDate: null,
  status: "planned",
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  elapsedMs: 0,
  completedAt: null,
  snoozeUntil: null,
});
export const openTask = (t: Task) =>
  t.status !== "done" && t.status !== "cancelled";
export const due = (t: Task) =>
  t.date && t.time ? at(t.date, t.time, t.zone) : null;
export const stable = (a: Task, b: Task) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);
export const elapsed = (t: Task, now: number) =>
  t.elapsedMs + (t.startedAt === null ? 0 : Math.max(0, now - t.startedAt));

export function selectNow(
  data: Data,
  now: number,
): { task: Task | null; reason: string; conflict: Task | null } {
  const eligible = data.tasks.filter(
    (t) => openTask(t) && (!t.snoozeUntil || t.snoozeUntil <= now),
  );
  const todays = eligible.filter((t) => t.date === localDate(now, t.zone));
  const fixed = todays
    .filter(
      (t) =>
        t.fixed &&
        due(t)! <= now &&
        now - due(t)! <=
          Math.max(30, t.duration ?? data.settings.unknownDuration) * 60000,
    )
    .sort((a, b) => due(a)! - due(b)! || stable(a, b));
  const active = data.tasks.find((t) => t.status === "active");
  if (active)
    return {
      task: active,
      reason: "Вы уже начали это дело",
      conflict: fixed.find((t) => t.id !== active.id) ?? null,
    };
  const manual = eligible.find((t) => t.id === data.selectedId);
  if (manual)
    return { task: manual, reason: "Вы выбрали это дело", conflict: null };
  if (fixed[0])
    return {
      task: fixed[0],
      reason: `Закреплено на ${fixed[0].time}`,
      conflict: null,
    };
  const timed = todays
    .filter((t) => !t.fixed && t.time && due(t)! <= now)
    .sort((a, b) => due(a)! - due(b)! || stable(a, b));
  if (timed[0])
    return {
      task: timed[0],
      reason: `Запланировано на ${timed[0].time}`,
      conflict: null,
    };
  const untimed = todays
    .filter((t) => !t.time)
    .sort((a, b) => Number(b.important) - Number(a.important) || stable(a, b));
  const next = data.tasks
    .filter((t) => openTask(t) && t.fixed && due(t)! > now)
    .sort((a, b) => due(a)! - due(b)!)[0];
  const fit = untimed.find(
    (t) =>
      t.important ||
      !next ||
      now +
        ((t.duration ?? data.settings.unknownDuration) + data.settings.buffer) *
          60000 <=
        due(next)!,
  );
  if (fit)
    return {
      task: fit,
      reason: fit.important
        ? "Важно сегодня"
        : "Есть место для небольшого шага",
      conflict: null,
    };
  const future = data.tasks
    .filter(
      (t) =>
        openTask(t) &&
        t.date === localDate(now, t.zone) &&
        t.time &&
        Math.max(due(t)!, t.snoozeUntil ?? 0) > now,
    )
    .sort(
      (a, b) =>
        Math.max(due(a)!, a.snoozeUntil ?? 0) -
        Math.max(due(b)!, b.snoozeUntil ?? 0),
    )[0];
  return {
    task: null,
    reason: future
      ? `Следующее дело в ${localTime(Math.max(due(future)!, future.snoozeUntil ?? 0), future.zone)}`
      : "Сейчас нет выбранного дела",
    conflict: null,
  };
}

export type Action = "start" | "pause" | "step" | "complete" | "cancel";
export function transition(
  data: Data,
  id: string,
  action: Action,
  now: number,
  stepId?: string,
) {
  const t = data.tasks.find((t) => t.id === id);
  if (!t) throw new Error("Дело уже удалено");
  if (!openTask(t)) throw new Error("Состояние дела уже изменилось");
  const pause = (x: Task) => {
    x.elapsedMs = elapsed(x, now);
    x.startedAt = null;
    x.status = "paused";
    x.updatedAt = now;
  };
  const reward = (key: string) => {
    if (!data.rewards.some((r) => r.key === key))
      data.rewards.push({ key, at: now });
  };
  if (action === "start") {
    if (t.status === "active") return;
    data.tasks.filter((x) => x.status === "active").forEach(pause);
    t.status = "active";
    t.startedAt = now;
    t.snoozeUntil = null;
    data.selectedId = t.id;
  } else if (action === "pause") {
    if (t.status !== "active") throw new Error("Дело сейчас не в работе");
    pause(t);
  } else if (action === "step") {
    if (t.status !== "active") throw new Error("Сначала начните дело");
    const step = t.steps.find((s) => !s.done);
    if (!step || step.id !== stepId) throw new Error("Шаг уже изменился");
    step.done = true;
    reward(`step:${t.id}:${step.id}`);
    if (t.steps.every((s) => s.done)) transition(data, id, "complete", now);
  } else {
    t.elapsedMs = elapsed(t, now);
    t.startedAt = null;
    t.snoozeUntil = null;
    t.status = action === "complete" ? "done" : "cancelled";
    t.completedAt = action === "complete" ? now : null;
    if (action === "complete") reward(`task:${t.id}`);
    if (data.selectedId === t.id) data.selectedId = null;
  }
  t.updatedAt = now;
}

export function generateRepeats(data: Data, now: number) {
  for (const r of data.rules.filter((r) => r.enabled)) {
    const today = localDate(now, r.zone);
    for (let i = 0; i < 14; i++) {
      const date = addDays(today, i);
      if (date < r.start) continue;
      const day = Temporal.PlainDate.from(date).dayOfWeek;
      if (
        (r.kind === "weekdays" && day > 5) ||
        (r.kind === "weekly" &&
          day !== Temporal.PlainDate.from(r.start).dayOfWeek) ||
        (r.kind === "custom" && !r.days.includes(day))
      )
        continue;
      if (
        data.tasks.some((t) => t.ruleId === r.id && t.occurrenceDate === date)
      )
        continue;
      data.tasks.push({
        ...makeTask(r.title, now, r.zone, `${r.id}:${date}`),
        note: r.note,
        date,
        time: r.time,
        duration: r.duration,
        important: r.important,
        fixed: r.fixed,
        reminder: r.reminder,
        steps: r.steps.map((s) => ({ ...s, done: false })),
        ruleId: r.id,
        occurrenceDate: date,
      });
    }
  }
}

export type PlanChange = {
  id: string;
  date: string | null;
  time: string | null;
};
export type Plan = {
  revision: number;
  createdAt: number;
  changes: PlanChange[];
  fixed: string[];
  conflicts: string[];
  importantOverflow: string[];
  afterHours: boolean;
};
export function rebuild(
  data: Data,
  now: number,
  revision: number,
  end = data.settings.end,
  target: "tomorrow" | "later" = "tomorrow",
): Plan {
  const settings = data.settings;
  const today = localDate(now, settings.zone);
  const finish = at(today, end, settings.zone);
  const buffer = settings.buffer * 60000;
  const tasks = data.tasks.filter(
    (t) =>
      openTask(t) &&
      (t.status === "active" || t.date === localDate(now, t.zone)),
  );
  const locked = tasks.filter((t) => t.fixed || t.status === "active");
  const intervals = locked
    .map((t) => {
      const start = t.status === "active" ? now : due(t)!;
      const duration = t.duration ?? settings.unknownDuration;
      return {
        id: t.id,
        start,
        end:
          start +
          Math.max(
            1,
            duration - (t.status === "active" ? elapsed(t, now) / 60000 : 0),
          ) *
            60000,
      };
    })
    .sort((a, b) => a.start - b.start);
  const conflicts = new Set<string>();
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++)
      if (intervals[j].start < intervals[i].end) {
        conflicts.add(intervals[i].id);
        conflicts.add(intervals[j].id);
      }
  const free: { start: number; end: number }[] = [];
  let cursor = Math.ceil(now / 60000) * 60000;
  for (const r of intervals) {
    if (r.end + buffer <= cursor) continue;
    if (r.start - buffer > cursor)
      free.push({ start: cursor, end: Math.min(finish, r.start - buffer) });
    cursor = Math.max(cursor, r.end + buffer);
  }
  if (cursor < finish) free.push({ start: cursor, end: finish });
  const slots = free.filter((s) => s.end > s.start);
  let budget =
    slots.reduce((n, s) => n + s.end - s.start, 0) * settings.capacity;
  const plan: Plan = {
    revision,
    createdAt: now,
    changes: [],
    fixed: locked.map((t) => t.id),
    conflicts: [...conflicts],
    importantOverflow: [],
    afterHours: finish <= now,
  };
  for (const t of tasks
    .filter((t) => !t.fixed && t.status !== "active")
    .sort(
      (a, b) => Number(b.important) - Number(a.important) || stable(a, b),
    )) {
    const length = (t.duration ?? settings.unknownDuration) * 60000 + buffer;
    const slot =
      length <= budget
        ? slots.find(
            (s) => Math.max(s.start, t.snoozeUntil ?? 0) + length <= s.end,
          )
        : undefined;
    let change: PlanChange;
    if (slot) {
      slot.start = Math.max(slot.start, t.snoozeUntil ?? 0);
      change = {
        id: t.id,
        date: localDate(slot.start, t.zone),
        time: localTime(slot.start, t.zone),
      };
      slot.start += length;
      budget -= length;
    } else {
      change = {
        id: t.id,
        date: target === "tomorrow" ? addDays(localDate(now, t.zone), 1) : null,
        time: null,
      };
      if (t.important) plan.importantOverflow.push(t.id);
    }
    if (t.date !== change.date || t.time !== change.time)
      plan.changes.push(change);
  }
  return plan;
}
export function applyPlan(
  data: Data,
  plan: Plan,
  revision: number,
  now: number,
) {
  if (plan.revision !== revision || now - plan.createdAt > 60000)
    throw new Error("Предложение устарело. Пересчитайте план");
  for (const c of plan.changes) {
    const t = data.tasks.find((t) => t.id === c.id);
    if (!t || t.fixed || t.status === "active")
      throw new Error("План изменился. Пересчитайте предложение");
    Object.assign(t, c, { updatedAt: now, snoozeUntil: null });
    if (!t.time) t.reminder = "off";
  }
  data.selectedId = null;
}
export function reminderEvents(data: Data, now: number) {
  return data.tasks.flatMap((t) => {
    const moment = due(t);
    if (
      !openTask(t) ||
      t.status === "active" ||
      t.reminder === "off" ||
      moment === null
    )
      return [];
    const trigger = t.snoozeUntil ?? moment;
    if (t.snoozeUntil && now < trigger) return [];
    const before =
      !t.snoozeUntil &&
      t.reminder === "before" &&
      now >= moment - data.settings.beforeMinutes * 60000 &&
      now < moment;
    if (!before && now < trigger) return [];
    const slot =
      t.reminder === "repeat" && now - trigger <= 3600000
        ? Math.floor((now - trigger) / (data.settings.repeatMinutes * 60000))
        : 0;
    return [
      {
        taskId: t.id,
        key: `${t.id}|${t.updatedAt}|${trigger}|${before ? "before" : slot}`,
        late: now - trigger > 3600000,
      },
    ];
  });
}
export function parseImport(text: string): Data {
  if (new TextEncoder().encode(text).length > 5_000_000)
    throw new Error("Файл больше 5 МБ");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Не удалось прочитать JSON");
  }
  const parsed = dataSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Файл не подходит: проверьте формат, версию и связи данных",
    );
  return parsed.data;
}
