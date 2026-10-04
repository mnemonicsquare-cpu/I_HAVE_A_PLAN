import { describe, it, expect } from "vitest";
import {
  addDays,
  applyPlan,
  at,
  dataSchema,
  elapsed,
  generateRepeats,
  initialData,
  localDate,
  localTime,
  makeTask,
  parseImport,
  rebuild,
  reminderEvents,
  selectNow,
  transition,
  type Task,
  type Rule,
} from "./domain";
const zone = "Europe/Moscow";
const now = at("2026-10-05", "10:00", zone);
const task = (id: string, patch: Partial<Task> = {}) => ({
  ...makeTask(id, now, zone, id),
  date: "2026-10-05",
  ...patch,
});
const withTasks = (...tasks: Task[]) => ({ ...initialData(zone), tasks });
describe("Выбор одного действия", () => {
  it("устойчив при одинаковом времени и не зависит от порядка массива", () => {
    const a = task("a"),
      b = task("b");
    expect(selectNow(withTasks(b, a), now).task?.id).toBe("a");
    expect(selectNow(withTasks(a, b), now + 1000).task?.id).toBe("a");
  });
  it("активное важнее ручного, показывает конфликт", () => {
    const d = withTasks(
      task("a", { status: "active", startedAt: now - 1000 }),
      task("b"),
      task("c", { fixed: true, time: "10:00" }),
    );
    d.selectedId = "b";
    const picked = selectNow(d, now);
    expect(picked.task?.id).toBe("a");
    expect(picked.conflict?.id).toBe("c");
  });
  it("ручной выбор может взять дело без даты", () => {
    const d = withTasks(
      task("a", { date: null }),
      task("b", { important: true }),
    );
    d.selectedId = "a";
    expect(selectNow(d, now).reason).toBe("Вы выбрали это дело");
  });
  it("исключает отложенные, завершённые, отменённые, без даты и будущие", () => {
    const d = withTasks(
      task("a", { snoozeUntil: now + 60000 }),
      task("b", { status: "done", completedAt: now }),
      task("c", { status: "cancelled" }),
      task("d", { date: null }),
      task("e", { time: "18:00" }),
    );
    d.selectedId = "a";
    expect(selectNow(d, now).task).toBeNull();
    expect(selectNow(d, now).reason).toBe("Следующее дело в 18:00");
  });
  it("истёкшая закреплённая встреча не удерживает экран", () => {
    expect(
      selectNow(
        withTasks(task("a", { time: "08:00", fixed: true }), task("b")),
        now,
      ).task?.id,
    ).toBe("b");
  });
  it("очередь: закреплённое, мягкое, важное, обычное", () => {
    const tasks = [
      task("a"),
      task("b", { important: true }),
      task("c", { time: "09:00" }),
      task("d", { time: "09:55", fixed: true }),
    ];
    expect(selectNow(withTasks(...tasks), now).task?.id).toBe("d");
    expect(selectNow(withTasks(...tasks.slice(0, 3)), now).task?.id).toBe("c");
    expect(selectNow(withTasks(...tasks.slice(0, 2)), now).task?.id).toBe("b");
  });
  it("не предлагает длинное обычное дело перед событием", () => {
    expect(
      selectNow(
        withTasks(
          task("a", { duration: 60 }),
          task("b", { fixed: true, time: "10:15" }),
        ),
        now,
      ).task,
    ).toBeNull();
  });
});
describe("Переходы и шаги", () => {
  it("переключает с явной паузой и сохраняет время", () => {
    const d = withTasks(task("a"), task("b"));
    transition(d, "a", "start", now);
    transition(d, "b", "start", now + 90000);
    expect(d.tasks[0].status).toBe("paused");
    expect(d.tasks[0].elapsedMs).toBe(90000);
    expect(d.tasks.filter((t) => t.status === "active")).toHaveLength(1);
  });
  it("пауза и возобновление не учитывают перерыв", () => {
    const d = withTasks(task("a"));
    transition(d, "a", "start", now);
    transition(d, "a", "pause", now + 60000);
    transition(d, "a", "start", now + 3600000);
    expect(elapsed(d.tasks[0], now + 3660000)).toBe(120000);
  });
  it("завершает последний шаг и выдаёт награду один раз", () => {
    const d = withTasks(
      task("a", { steps: [{ id: "s", title: "Открыть", done: false }] }),
    );
    transition(d, "a", "start", now);
    transition(d, "a", "step", now + 1000, "s");
    expect(d.tasks[0].status).toBe("done");
    expect(d.rewards).toHaveLength(2);
    expect(() => transition(d, "a", "step", now + 2000, "s")).toThrow();
  });
  it("повторная доставка клика не завершает следующий шаг", () => {
    const d = withTasks(
      task("a", {
        steps: [
          { id: "s1", title: "Один", done: false },
          { id: "s2", title: "Два", done: false },
        ],
      }),
    );
    transition(d, "a", "start", now);
    transition(d, "a", "step", now + 1, "s1");
    expect(() => transition(d, "a", "step", now + 2, "s1")).toThrow(
      "Шаг уже изменился",
    );
    expect(d.tasks[0].steps[1].done).toBe(false);
  });
  it("повторный старт не сбрасывает часы, неверная пауза отклоняется", () => {
    const d = withTasks(task("a"));
    expect(() => transition(d, "a", "pause", now)).toThrow();
    transition(d, "a", "start", now);
    transition(d, "a", "start", now + 100);
    expect(d.tasks[0].startedAt).toBe(now);
  });
});
describe("Календарь и повторения", () => {
  const rule: Rule = {
    id: "r",
    title: "Повтор",
    note: "",
    date: "2026-01-01",
    time: "09:00",
    zone,
    duration: 5,
    important: false,
    fixed: false,
    reminder: "at",
    steps: [],
    kind: "daily",
    days: [1],
    start: "2026-01-01",
    enabled: true,
  };
  it.each([
    ["2024-02-28", "2024-02-29"],
    ["2024-02-29", "2024-03-01"],
    ["2025-12-31", "2026-01-01"],
  ])("переходит от %s к %s", (a, b) => expect(addDays(a, 1)).toBe(b));
  it("совместимая DST: пропущенное время сдвигается, неоднозначное берётся раньше", () => {
    expect(
      new Date(at("2026-03-08", "02:30", "America/New_York")).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      new Date(at("2026-11-01", "01:30", "America/New_York")).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
  it("смена даты зависит от пояса", () => {
    expect(localDate(at("2026-01-01", "00:30", zone), "America/New_York")).toBe(
      "2025-12-31",
    );
    expect(localTime(now, zone)).toBe("10:00");
  });
  it("после долгого отсутствия только 14 дней вперёд, без дублей", () => {
    const d = initialData(zone);
    d.rules = [rule];
    generateRepeats(d, now);
    generateRepeats(d, now);
    expect(d.tasks).toHaveLength(14);
    expect(d.tasks[0].occurrenceDate).toBe("2026-10-05");
    d.tasks[0].date = null;
    generateRepeats(d, now);
    expect(d.tasks).toHaveLength(14);
  });
  it.each([
    ["weekdays", 10],
    ["weekly", 2],
    ["custom", 2],
  ] as const)("правило %s создаёт %s экземпляров", (kind, count) => {
    const d = initialData(zone);
    d.rules = [{ ...rule, kind }];
    generateRepeats(d, now);
    expect(d.tasks).toHaveLength(count);
  });
  it("завершение не завершает серию и сохраняет прошлую историю", () => {
    const d = initialData(zone);
    d.rules = [rule];
    generateRepeats(d, now);
    transition(d, d.tasks[0].id, "complete", now);
    generateRepeats(d, now + 86400000 * 30);
    expect(d.tasks.filter((t) => t.status === "done")).toHaveLength(1);
    expect(d.tasks).toHaveLength(28);
  });
});
describe("Пересборка", () => {
  it("сохраняет закреплённое и активное, учитывает буфер и 70%", () => {
    const d = withTasks(
      task("a", { time: "10:30", fixed: true, duration: 30 }),
      task("b", { duration: 20 }),
      task("c", { duration: 10, important: true }),
      task("d", { duration: 500 }),
    );
    const plan = rebuild(d, now, 3, "12:00");
    expect(plan.fixed).toEqual(["a"]);
    expect(plan.changes.find((c) => c.id === "c")?.time).toBe("10:00");
    expect(plan.changes.find((c) => c.id === "b")?.time).toBe("11:05");
    expect(plan.changes.find((c) => c.id === "d")?.date).toBe("2026-10-06");
  });
  it("выявляет пересечения и не двигает встречи", () => {
    const d = withTasks(
      task("a", { fixed: true, time: "10:00", duration: 60 }),
      task("b", { fixed: true, time: "10:30", duration: 60 }),
    );
    const p = rebuild(d, now, 0);
    expect(p.conflicts.sort()).toEqual(["a", "b"]);
    expect(p.changes).toHaveLength(0);
  });
  it("уважает вчерашнее активное дело", () => {
    const d = withTasks(
      task("a", {
        date: "2026-10-04",
        status: "active",
        startedAt: now,
        duration: 60,
      }),
      task("b", { duration: 5 }),
    );
    expect(rebuild(d, now, 0).changes[0].time).toBe("11:05");
  });
  it("важные не помещаются честно; после конца дня нет ночной очереди", () => {
    const d = withTasks(task("a", { important: true }));
    const p = rebuild(d, at("2026-10-05", "22:00", zone), 0);
    expect(p.afterHours).toBe(true);
    expect(p.importantOverflow).toEqual(["a"]);
    expect(p.changes[0]).toEqual({ id: "a", date: "2026-10-06", time: null });
  });
  it("пустое предложение и стабильность", () => {
    const d = withTasks(task("a", { status: "done", completedAt: now }));
    expect(rebuild(d, now, 0).changes).toHaveLength(0);
    expect(rebuild(d, now, 0)).toEqual(rebuild(d, now, 0));
  });
  it("отклоняет устаревшее предложение по версии и времени", () => {
    const d = withTasks(task("a"));
    const p = rebuild(d, now, 1);
    expect(() => applyPlan(d, p, 2, now)).toThrow();
    expect(() => applyPlan(d, p, 1, now + 60001)).toThrow();
    applyPlan(d, p, 1, now);
    expect(d.tasks[0].time).toBe("10:00");
  });
  it("не ставит отложенное дело до отсрочки", () => {
    const d = withTasks(task("a", { snoozeUntil: now + 3600000 }));
    expect(rebuild(d, now, 0).changes[0].time).toBe("11:00");
  });
});
describe("Напоминания и импорт", () => {
  it("предварительное и точное — разные события", () => {
    const d = withTasks(task("a", { time: "10:00", reminder: "before" }));
    expect(reminderEvents(d, now - 300001)).toHaveLength(0);
    expect(reminderEvents(d, now - 300000)[0].key).not.toBe(
      reminderEvents(d, now)[0].key,
    );
  });
  it("перенос отменяет старое; завершение и отмена исключаются", () => {
    const d = withTasks(task("a", { time: "10:00", reminder: "repeat" }));
    expect(reminderEvents(d, now)).toHaveLength(1);
    d.tasks[0].snoozeUntil = now + 300000;
    expect(reminderEvents(d, now)).toHaveLength(0);
    transition(d, "a", "cancel", now);
    expect(reminderEvents(d, now + 600000)).toHaveLength(0);
  });
  it("долгое отсутствие даёт одно событие, не список пропущенных интервалов", () => {
    const d = withTasks(task("a", { time: "10:00", reminder: "repeat" }));
    expect(reminderEvents(d, now + 8 * 3600000)).toHaveLength(1);
    expect(reminderEvents(d, now + 8 * 3600000)[0].late).toBe(true);
  });
  it("экспорт/импорт восстанавливает модель; неверный формат отклоняется", () => {
    const d = withTasks(task("a"));
    expect(parseImport(JSON.stringify(d))).toEqual(d);
    for (const raw of [
      "{}",
      "null",
      "not json",
      JSON.stringify({ ...d, schemaVersion: 99 }),
      JSON.stringify({ ...d, tasks: [...d.tasks, ...d.tasks] }),
    ])
      expect(() => parseImport(raw)).toThrow();
  });
  it("валидирует дату, длительность, связи, количество активных", () => {
    expect(
      dataSchema.safeParse(withTasks(task("a", { date: "2026-02-29" })))
        .success,
    ).toBe(false);
    expect(
      dataSchema.safeParse(withTasks(task("a", { duration: -1 }))).success,
    ).toBe(false);
    expect(
      dataSchema.safeParse(
        withTasks(
          task("a", { ruleId: "unknown", occurrenceDate: "2026-10-05" }),
        ),
      ).success,
    ).toBe(false);
    expect(
      dataSchema.safeParse(
        withTasks(
          task("a", { status: "active", startedAt: now }),
          task("b", { status: "active", startedAt: now }),
        ),
      ).success,
    ).toBe(false);
  });
  it("не исполняет HTML и не принимает слишком большой файл", () => {
    const d = withTasks(task("a", { title: "<script>alert(1)</script>" }));
    expect(parseImport(JSON.stringify(d)).tasks[0].title).toContain("<script>");
    expect(() => parseImport("a".repeat(5_000_001))).toThrow("5 МБ");
  });
});
