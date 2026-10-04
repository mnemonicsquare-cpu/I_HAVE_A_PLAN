import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./storage";
import { initialData, makeTask, transition } from "./domain";
const stores: Store[] = [];
function db(name: string = crypto.randomUUID()) {
  const s = new Store(name);
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) {
    s.close();
    await Dexie.delete(s.name);
  }
  stores.length = 0;
});
describe("Транзакционная база", () => {
  it("актуальные напоминания атомарно выдаются одной вкладке и учитывают перенос", async () => {
    const s = db();
    await s.load();
    const now = Date.parse("2026-10-05T07:00:00Z");
    await s.change(0, (d) => {
      d.tasks.push({
        ...makeTask("Сигнал", now, "Europe/Moscow", "a"),
        date: "2026-10-05",
        time: "10:00",
        reminder: "at",
      });
    });
    const second = db(s.name);
    const results = await Promise.all([s.claimDue(now), second.claimDue(now)]);
    expect(results.flat()).toHaveLength(1);
    await s.change(1, (d) => {
      d.tasks[0].time = "11:00";
      d.tasks[0].updatedAt = now + 1;
    });
    expect(await second.claimDue(now)).toHaveLength(0);
  });
  it("сохраняет и восстанавливает активное дело после закрытия", async () => {
    const s = db();
    await s.load();
    await s.change(0, (d) => {
      d.tasks.push(makeTask("Дело", 1000, "Europe/Moscow", "a"));
      transition(d, "a", "start", 2000);
    });
    const name = s.name;
    s.close();
    const restored = await db(name).load();
    expect(restored.data.tasks[0].startedAt).toBe(2000);
  });
  it("откатывает ошибочную транзакцию целиком", async () => {
    const s = db();
    await s.load();
    await expect(
      s.change(0, (d) => {
        d.tasks.push(makeTask("", 1000, "Europe/Moscow", "a"));
      }),
    ).rejects.toThrow();
    expect((await s.load()).data.tasks).toHaveLength(0);
    expect((await s.load()).revision).toBe(0);
  });
  it("две вкладки не перезаписывают друг друга", async () => {
    const s = db();
    await s.load();
    const second = db(s.name);
    const results = await Promise.allSettled([
      s.change(0, (d) => {
        d.settings.sound = true;
      }),
      second.change(0, (d) => {
        d.settings.fox = false;
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await s.load()).revision).toBe(1);
  });
  it("отмена не затирает последующие изменения", async () => {
    const s = db();
    await s.load();
    await s.change(
      0,
      (d) => {
        d.tasks.push(makeTask("Дело", 1000, "Europe/Moscow", "a"));
      },
      "Добавлено",
    );
    await s.change(1, (d) => {
      d.settings.sound = true;
    });
    await expect(s.undo(1)).rejects.toThrow();
    expect((await s.load()).data.settings.sound).toBe(true);
  });
  it("ошибочное завершение можно отменить без повторной награды", async () => {
    const s = db();
    await s.load();
    await s.change(0, (d) =>
      d.tasks.push(makeTask("Дело", 1000, "Europe/Moscow", "a")),
    );
    await s.change(1, (d) => transition(d, "a", "complete", 2000), "Готово");
    await s.undo(2);
    await s.change(3, (d) => transition(d, "a", "complete", 3000), "Готово");
    expect((await s.load()).data.rewards).toHaveLength(1);
  });
  it("напоминание забирает ровно одна вкладка", async () => {
    const s = db();
    const second = db(s.name);
    await s.load();
    const got = await Promise.all([
      s.claim(["event"], 1000),
      second.claim(["event"], 1000),
    ]);
    expect(got.flat()).toEqual(["event"]);
  });
  it("импорт проверяет данные до записи и защищён версией", async () => {
    const s = db();
    await s.load();
    const invalid = {
      ...initialData(),
      tasks: [makeTask("", 1000, "Europe/Moscow")],
    };
    await expect(s.restore(invalid, 0)).rejects.toThrow();
    expect((await s.load()).revision).toBe(0);
    await s.change(0, (d) => {
      d.settings.sound = true;
    });
    await expect(s.restore(initialData(), 0)).rejects.toThrow();
    expect((await s.load()).data.settings.sound).toBe(true);
  });
  it("миграция v1 сохраняет содержимое", async () => {
    const name = crypto.randomUUID();
    const old = new Dexie(name);
    old.version(1).stores({ state: "id" });
    const data = initialData();
    data.tasks.push(makeTask("Старое дело", 1000, "Europe/Moscow", "old"));
    await old.table("state").put({ id: "main", revision: 4, data });
    old.close();
    const migrated = await db(name).load();
    expect(migrated.data.tasks[0].title).toBe("Старое дело");
    expect(migrated.revision).toBe(4);
  });
});
