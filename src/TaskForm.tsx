import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import {
  addDays,
  localDate,
  makeTask,
  taskSchema,
  type Task,
  type Rule,
  type Data,
} from "./domain";
import { store, saveDraft } from "./storage";
import { copy } from "./ui";
type Draft = {
  task: Task;
  baseTask?: Task;
  when: string;
  repeat: Rule["kind"] | "none";
  days: number[];
  scope: "one" | "future";
};
export function TaskForm({
  task,
  data,
  context,
  onSave,
}: {
  task?: Task;
  data: Data;
  context: string;
  onSave: (
    task: Task,
    repeat: Draft["repeat"],
    days: number[],
    scope: Draft["scope"],
    nowChoice: boolean,
  ) => Promise<boolean>;
}) {
  const today = localDate(Date.now(), data.settings.zone);
  const key = task ? `edit:${task.id}` : "new";
  const rule = data.rules.find((r) => r.id === task?.ruleId);
  const [draft, setDraft] = useState<Draft>(() => ({
    baseTask: task ? structuredClone(task) : undefined,
    task: task
      ? structuredClone(task)
      : {
          ...makeTask("", Date.now(), data.settings.zone),
          date: context === "today" ? today : null,
        },
    when: task
      ? task.date
        ? "date"
        : "none"
      : context === "today"
        ? "today"
        : "none",
    repeat: rule?.kind ?? "none",
    days: rule?.days ?? [1],
    scope: "one",
  }));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    let alive = true;
    void store.drafts
      .get(key)
      .then((saved) => {
        if (alive) {
          if (saved) {
            try {
              const raw = JSON.parse(saved.value) as Draft;
              if (
                raw.task &&
                typeof raw.task.title === "string" &&
                Array.isArray(raw.task.steps) &&
                ["none", "daily", "weekdays", "weekly", "custom"].includes(
                  raw.repeat,
                )
              ) {
                setDraft(raw);
                if (
                  task &&
                  JSON.stringify(raw.baseTask ?? raw.task) !==
                    JSON.stringify(task)
                ) {
                  setConflict(true);
                  setError(
                    "После создания черновика дело изменилось. Скопируйте нужный текст и загрузите актуальную версию, чтобы не затереть изменения",
                  );
                }
              }
            } catch {
              setError("Не удалось восстановить черновик");
            }
          }
          setReady(true);
        }
      })
      .catch(() =>
        setError("Не удалось открыть черновик. Запись временно недоступна"),
      );
    return () => {
      alive = false;
    };
  }, [key]);
  const update = (value: Partial<Draft>) => {
    const next = { ...draft, ...value };
    setDraft(next);
    void saveDraft(key, JSON.stringify(next)).catch(() =>
      setError(
        "Черновик не сохраняется. Скопируйте введённый текст перед закрытием",
      ),
    );
  };
  const setTask = (value: Partial<Task>) =>
    update({ task: { ...draft.task, ...value } });
  const setWhen = (when: string) => {
    let date: string | null = null;
    if (when === "today" || when === "now") date = today;
    if (when === "tomorrow") date = addDays(today, 1);
    if (when === "date") date = draft.task.date ?? today;
    update({
      when,
      task: {
        ...draft.task,
        date,
        time: date ? draft.task.time : null,
        fixed: date ? draft.task.fixed : false,
        reminder: date ? draft.task.reminder : "off",
      },
    });
  };
  if (!ready) return <p role="status">{error || "Открываем черновик…"}</p>;
  const t = draft.task;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (conflict) return;
        setError("");
        const parsed = taskSchema.safeParse({ ...t, updatedAt: Date.now() });
        if (!parsed.success) {
          setError("Проверьте название, дату, длительность и заполнение шагов");
          return;
        }
        if (draft.repeat !== "none" && !t.date) {
          setError("Для повторения выберите первую дату");
          return;
        }
        if (draft.repeat === "custom" && !draft.days.length) {
          setError("Выберите хотя бы один день недели");
          return;
        }
        setSaving(true);
        const saved = await onSave(
          parsed.data,
          draft.repeat,
          draft.days,
          draft.scope,
          draft.when === "now",
        );
        setSaving(false);
        if (saved) await store.drafts.delete(key);
      }}
    >
      <label>
        {copy.title}
        <input
          name="title"
          value={t.title}
          onChange={(e) => setTask({ title: e.target.value })}
          maxLength={500}
          required
          aria-describedby={error ? "form-error" : undefined}
          placeholder="Например, записаться к врачу"
        />
      </label>
      <fieldset>
        <legend>Когда</legend>
        <div className="chips">
          {[
            ["now", "Сейчас"],
            ["today", "Сегодня"],
            ["tomorrow", "Завтра"],
            ["date", "Выбрать дату"],
            ["none", "Без даты"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.when === value}
              onClick={() => setWhen(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {t.date && (
        <div className="field-row">
          <label>
            Дата
            <input
              type="date"
              value={t.date}
              required
              onChange={(e) =>
                update({ when: "date", task: { ...t, date: e.target.value } })
              }
            />
          </label>
          <label>
            Время, если нужно
            <input
              type="time"
              value={t.time ?? ""}
              onChange={(e) =>
                setTask({
                  time: e.target.value || null,
                  fixed: e.target.value ? t.fixed : false,
                  reminder: e.target.value ? t.reminder : "off",
                })
              }
            />
          </label>
        </div>
      )}
      {t.time && (
        <>
          <label>
            Напомнить
            <select
              aria-label="Напомнить"
              value={t.reminder}
              onChange={(e) =>
                setTask({ reminder: e.target.value as Task["reminder"] })
              }
            >
              <option value="off">Без напоминания</option>
              <option value="at">В нужный момент</option>
              <option value="before">Заранее и в нужный момент</option>
              <option value="repeat">Повторять, пока приложение открыто</option>
            </select>
          </label>
          <p className="hint">{copy.reminders}</p>
        </>
      )}
      <details open={task ? true : undefined}>
        <summary>Дополнительно</summary>
        <div className="details-body">
          <label>
            Примерная длительность, минут
            <input
              type="number"
              min="1"
              max="720"
              placeholder="Пока не знаю"
              value={t.duration ?? ""}
              onChange={(e) =>
                setTask({
                  duration: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={t.important}
              onChange={(e) => setTask({ important: e.target.checked })}
            />
            Важно сделать в этот день
          </label>
          {t.time && (
            <label className="check">
              <input
                type="checkbox"
                checked={t.fixed}
                onChange={(e) => setTask({ fixed: e.target.checked })}
              />
              Время закреплено
            </label>
          )}
          <fieldset>
            <legend>Маленькие шаги</legend>
            <p className="hint">Одно понятное действие за раз.</p>
            {t.steps.map((step, i) => (
              <div className="step-edit" key={step.id}>
                <label className="sr-only" htmlFor={`step-${i}`}>
                  Шаг {i + 1}
                </label>
                <input
                  id={`step-${i}`}
                  value={step.title}
                  maxLength={500}
                  onChange={(e) =>
                    setTask({
                      steps: t.steps.map((s) =>
                        s.id === step.id ? { ...s, title: e.target.value } : s,
                      ),
                    })
                  }
                  placeholder="Найти номер клиники"
                />
                <div className="step-tools">
                  <button
                    type="button"
                    aria-label={`Шаг ${i + 1} выше`}
                    disabled={i === 0}
                    onClick={() => {
                      const steps = [...t.steps];
                      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                      setTask({ steps });
                    }}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Шаг ${i + 1} ниже`}
                    disabled={i === t.steps.length - 1}
                    onClick={() => {
                      const steps = [...t.steps];
                      [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                      setTask({ steps });
                    }}
                  >
                    <ArrowDown size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Удалить шаг ${i + 1}`}
                    onClick={() =>
                      setTask({
                        steps: t.steps.filter((s) => s.id !== step.id),
                      })
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={t.steps.length >= 100}
              onClick={() =>
                setTask({
                  steps: [
                    ...t.steps,
                    { id: crypto.randomUUID(), title: "", done: false },
                  ],
                })
              }
            >
              <Plus size={18} />
              Добавить шаг
            </button>
          </fieldset>
          {task?.ruleId && (
            <label>
              Изменить
              <select
                aria-label="Изменить"
                value={draft.scope}
                onChange={(e) =>
                  update({ scope: e.target.value as Draft["scope"] })
                }
              >
                <option value="one">Только это дело</option>
                <option value="future">Это и будущие</option>
              </select>
            </label>
          )}
          {(!task?.ruleId || draft.scope === "future") && (
            <>
              <label>
                Повторение
                <select
                  aria-label="Повторение"
                  value={draft.repeat}
                  onChange={(e) =>
                    update({ repeat: e.target.value as Draft["repeat"] })
                  }
                >
                  <option value="none">Не повторять</option>
                  <option value="daily">Ежедневно</option>
                  <option value="weekdays">По будням</option>
                  <option value="weekly">Еженедельно</option>
                  <option value="custom">По выбранным дням</option>
                </select>
              </label>
              {draft.repeat === "custom" && (
                <fieldset>
                  <legend>Дни недели</legend>
                  <div className="chips">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                      (day, i) => (
                        <button
                          type="button"
                          key={day}
                          aria-pressed={draft.days.includes(i + 1)}
                          onClick={() =>
                            update({
                              days: draft.days.includes(i + 1)
                                ? draft.days.filter((x) => x !== i + 1)
                                : [...draft.days, i + 1],
                            })
                          }
                        >
                          {day}
                        </button>
                      ),
                    )}
                  </div>
                </fieldset>
              )}
            </>
          )}
          <label>
            Заметка
            <textarea
              value={t.note}
              maxLength={10000}
              rows={3}
              onChange={(e) => setTask({ note: e.target.value })}
            />
          </label>
          <p className="hint">
            Часовой пояс дела: {t.zone}. При поездке время сохраняется в этом
            поясе.
          </p>
        </div>
      </details>
      {error && (
        <p role="alert" id="form-error" className="error">
          {error}
        </p>
      )}
      <div className="form-footer">
        <p className="hint">
          {t.date
            ? `В плане на ${t.date.split("-").reverse().join(".")}`
            : "Сохранится в «Позже»"}
          . Черновик сохраняется.
        </p>
        {conflict && (
          <button
            type="button"
            onClick={() => {
              if (task) {
                update({
                  task: structuredClone(task),
                  baseTask: structuredClone(task),
                  when: task.date ? "date" : "none",
                });
                setConflict(false);
                setError("");
              }
            }}
          >
            Загрузить актуальное дело
          </button>
        )}
        <button className="primary" disabled={saving || conflict}>
          {saving ? "Сохраняем…" : task ? "Сохранить изменения" : copy.add}
        </button>
      </div>
    </form>
  );
}
