import Dexie, { type Table } from "dexie";
import {
  dataSchema,
  generateRepeats,
  initialData,
  reminderEvents,
  type Data,
} from "./domain";
export type Snapshot = {
  id: "main";
  revision: number;
  data: Data;
  undo?: { data: Data; label: string; revision: number };
};
export class Store extends Dexie {
  state!: Table<Snapshot, string>;
  reminders!: Table<{ key: string; at: number }, string>;
  drafts!: Table<{ id: string; value: string }, string>;
  constructor(name = "seychas") {
    super(name);
    this.version(1).stores({ state: "id" });
    this.version(2)
      .stores({ state: "id", reminders: "key,at", drafts: "id" })
      .upgrade((tx) =>
        tx
          .table("state")
          .toCollection()
          .modify((s: Snapshot) => {
            s.data = dataSchema.parse(s.data);
            s.revision ??= 0;
          }),
      );
  }
  async load(): Promise<Snapshot> {
    return this.transaction("rw", this.state, async () => {
      let s = await this.state.get("main");
      if (!s) {
        s = { id: "main", revision: 0, data: initialData() };
        await this.state.put(s);
      }
      dataSchema.parse(s.data);
      return s;
    });
  }
  async change(
    expected: number,
    mutate: (data: Data) => void,
    label?: string,
  ): Promise<Snapshot> {
    return this.transaction("rw", this.state, async () => {
      const old = await this.state.get("main");
      if (!old || old.revision !== expected)
        throw new Error(
          "Данные изменились в другой вкладке. Повторите действие",
        );
      const data = structuredClone(old.data);
      mutate(data);
      dataSchema.parse(data);
      const next: Snapshot = { id: "main", revision: old.revision + 1, data };
      if (label) next.undo = { data: old.data, label, revision: next.revision };
      await this.state.put(next);
      return next;
    });
  }
  async undo(expected: number) {
    return this.transaction("rw", this.state, async () => {
      const old = await this.state.get("main");
      if (
        !old?.undo ||
        old.revision !== expected ||
        old.undo.revision !== expected
      )
        throw new Error(
          "После этого действия данные изменились. Отмена недоступна",
        );
      const data = structuredClone(old.undo.data);
      data.rewards = old.data.rewards;
      const next: Snapshot = { id: "main", revision: old.revision + 1, data };
      await this.state.put(next);
      return next;
    });
  }
  async refresh(now: number) {
    return this.transaction("rw", this.state, async () => {
      const old = await this.state.get("main");
      if (!old) return;
      const data = structuredClone(old.data);
      generateRepeats(data, now);
      if (data.tasks.length !== old.data.tasks.length) {
        dataSchema.parse(data);
        await this.state.put({
          ...old,
          data,
          revision: old.revision + 1,
          undo: undefined,
        });
      }
    });
  }
  async claim(keys: string[], now: number) {
    return this.transaction("rw", this.reminders, async () => {
      const claimed: string[] = [];
      for (const key of keys)
        if (!(await this.reminders.get(key))) {
          await this.reminders.add({ key, at: now });
          claimed.push(key);
        }
      await this.reminders
        .where("at")
        .below(now - 30 * 86400000)
        .delete();
      return claimed;
    });
  }
  async claimDue(now: number) {
    return this.transaction("rw", this.state, this.reminders, async () => {
      const snapshot = await this.state.get("main");
      if (!snapshot) return [];
      const events = reminderEvents(snapshot.data, now);
      const result: typeof events = [];
      for (const event of events)
        if (!(await this.reminders.get(event.key))) {
          await this.reminders.add({ key: event.key, at: now });
          result.push(event);
        }
      await this.reminders
        .where("at")
        .below(now - 30 * 86400000)
        .delete();
      return result;
    });
  }
  async restore(data: Data, expected: number) {
    dataSchema.parse(data);
    return this.transaction(
      "rw",
      this.state,
      this.reminders,
      this.drafts,
      async () => {
        const old = await this.state.get("main");
        if (!old || old.revision !== expected)
          throw new Error(
            "Данные изменились. Сначала обновите предпросмотр импорта",
          );
        const next: Snapshot = {
          id: "main",
          revision: old.revision + 1,
          data: structuredClone(data),
        };
        await this.state.put(next);
        await this.reminders.clear();
        await this.drafts.clear();
        return next;
      },
    );
  }
}
export const store = new Store();
export const saveDraft = (id: string, value: string) =>
  store.drafts.put({ id, value });
export async function exportData(data: Data) {
  const blob = new Blob([JSON.stringify(data)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "seychas-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
