import { useEffect, useState, useRef, type ReactNode } from "react";
import { liveQuery } from "dexie";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Circle,
  CalendarDays,
  Layers,
  Plus,
  Settings as SettingsIcon,
  ArrowRight,
  Play,
  Pause,
  Check,
  Compass,
  MoreHorizontal,
  Clock,
  Lock,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { ZodError } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import {
  addDays,
  applyPlan,
  at,
  due,
  elapsed,
  generateRepeats,
  localDate,
  localTime,
  makeTask,
  openTask,
  selectNow,
  stable,
  transition,
  type Data,
  type Task,
  type Rule,
} from "./domain";
import { exportData, store, type Snapshot } from "./storage";
import { ReminderService, chime } from "./services";
import { Dialog, Empty, Fox, copy } from "./ui";
import { TaskForm } from "./TaskForm";
import { SettingsPanel } from "./SettingsPanel";
import { Recovery } from "./Recovery";
type Modal = {
  kind: "add" | "edit" | "settings" | "recovery" | "choose" | "move" | "help";
  id?: string;
  revision: number;
};
const screens = { now: "Сейчас", today: "Сегодня", later: "Позже" };
type Screen = keyof typeof screens;
const getScreen = (): Screen =>
  location.hash === "#today"
    ? "today"
    : location.hash === "#later"
      ? "later"
      : "now";
export function App() {
  const [celebrate, setCelebrate] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [screen, setScreen] = useState(getScreen);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [toast, setToast] = useState("");
  const [dismissedUndo, setDismissedUndo] = useState(-1);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState("");
  const [reminders, setReminders] = useState<string[]>([]);
  const [late, setLate] = useState(false);
  const reminder = useRef(new ReminderService());
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    void store.drafts
      .get("quick")
      .then((saved) => {
        if (saved) setQuick(saved.value);
      })
      .catch(() => setError("Черновик не удалось восстановить"));
  }, []);
  useEffect(() => {
    let sub: ReturnType<ReturnType<typeof liveQuery>["subscribe"]> | undefined;
    let alive = true;
    void store
      .load()
      .then(() => {
        if (!alive) return;
        sub = liveQuery(() => store.state.get("main")).subscribe({
          next: (s) => {
            if (s) setSnapshot(s);
          },
          error: () =>
            setError(
              "Данные сейчас не сохраняются. Скачайте доступную копию и проверьте настройки браузера",
            ),
        });
        void store
          .refresh(Date.now())
          .catch(() => setError("Не удалось обновить повторения"));
      })
      .catch(() =>
        setError(
          "Не удалось открыть локальную базу. Данные сейчас не сохраняются. Проверьте настройки браузера и свободное место",
        ),
      );
    return () => {
      alive = false;
      sub?.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible")
        void store
          .refresh(Date.now())
          .catch(() => setError("Не удалось обновить повторения"));
    };
    const timer = setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    const hash = () => setScreen(getScreen());
    window.addEventListener("hashchange", hash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    if (snapshot)
      void reminder.current
        .check(snapshot.data, now, (ids, isLate) => {
          setReminders(ids);
          setLate(isLate);
        })
        .catch(() => setError("Не удалось сохранить состояние напоминания"));
  }, [snapshot, now]);
  const navigate = (value: Screen) => {
    location.hash = value;
    setScreen(value);
  };
  const change = async (
    mutate: (data: Data) => void,
    label?: string,
    expected = snapshot?.revision,
  ) => {
    if (inFlight.current || expected === undefined) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await store.change(expected, mutate, label);
      setSnapshot(next);
      if (label) setToast(label);
      return true;
    } catch (err) {
      setError(
        err instanceof ZodError
          ? "Проверьте значения: дату, длительность и поля настроек. Изменения не сохранены"
          : err instanceof Error
            ? err.message
            : "Не удалось сохранить. Попробуйте ещё раз",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const act = async (t: Task, action: Parameters<typeof transition>[2]) => {
    let earned = false;
    const result = await change(
      (d) => {
        const before = d.rewards.length;
        transition(
          d,
          t.id,
          action,
          Date.now(),
          t.steps.find((s) => !s.done)?.id,
        );
        earned = d.rewards.length > before;
      },
      action === "complete"
        ? "Дело завершено"
        : action === "step"
          ? "Шаг сохранён"
          : action === "pause"
            ? "Пауза сохранена"
            : action === "cancel"
              ? "Дело отменено"
              : undefined,
    );
    if (result && earned) {
      chime(snapshot!.data.settings.sound);
      if (snapshot!.data.settings.effects) {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 600);
      }
    }
    return result;
  };
  if (!snapshot)
    return (
      <main className="loading">
        <Fox />
        <h1>Сейчас</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Открываем ваши дела…"}
        </p>
        {error && (
          <button onClick={() => location.reload()}>Попробовать снова</button>
        )}
      </main>
    );
  const data = snapshot.data;
  const today = localDate(now, data.settings.zone);
  const selected = selectNow(data, now);
  const current = selected.task;
  const active = data.tasks.find((t) => t.status === "active");
  const modalTask = data.tasks.find((t) => t.id === modal?.id);
  const open = (kind: Modal["kind"], id?: string) =>
    setModal({ kind, id, revision: snapshot.revision });
  const selectTask = async (t: Task) => {
    if (
      await change((d) => {
        d.selectedId = t.id;
        const task = d.tasks.find((x) => x.id === t.id)!;
        task.snoozeUntil = null;
        task.updatedAt = Date.now();
        if (active && active.id !== task.id)
          transition(d, active.id, "pause", Date.now());
      }, undefined)
    ) {
      setModal(null);
      navigate("now");
    }
  };
  const moveTask = async (
    t: Task,
    date: string | null,
    time: string | null,
    snooze: number | null = null,
  ) => {
    const success = await change((d) => {
      const x = d.tasks.find((x) => x.id === t.id)!;
      if (x.status === "active") transition(d, x.id, "pause", Date.now());
      Object.assign(x, {
        date,
        time,
        fixed: date && time ? x.fixed : false,
        reminder: date && time ? x.reminder : "off",
        snoozeUntil: snooze,
        updatedAt: Date.now(),
      });
      if (d.selectedId === x.id) d.selectedId = null;
    }, "Дело перенесено");
    if (success) setModal(null);
    return success;
  };
  const saveTask = async (
    t: Task,
    repeat: Rule["kind"] | "none",
    days: number[],
    scope: "one" | "future",
    nowChoice: boolean,
  ) => {
    const isNew = modal?.kind === "add";
    const result = await change(
      (d) => {
        const time = Date.now();
        const existing = d.tasks.findIndex((x) => x.id === t.id);
        const updated = { ...t, updatedAt: time };
        if (!t.ruleId && repeat !== "none") {
          const ruleId = crypto.randomUUID();
          d.rules.push({
            id: ruleId,
            title: t.title,
            note: t.note,
            date: t.date,
            time: t.time,
            zone: t.zone,
            duration: t.duration,
            important: t.important,
            fixed: t.fixed,
            reminder: t.reminder,
            steps: t.steps.map((s) => ({ ...s, done: false })),
            kind: repeat,
            days,
            start: t.date!,
            enabled: true,
          });
          updated.ruleId = ruleId;
          updated.occurrenceDate = t.date;
        } else if (t.ruleId && scope === "future") {
          const rule = d.rules.find((r) => r.id === t.ruleId)!;
          rule.enabled = false;
          d.tasks = d.tasks.filter(
            (x) =>
              x.id === t.id ||
              x.ruleId !== rule.id ||
              !openTask(x) ||
              x.status === "active" ||
              x.status === "paused" ||
              x.occurrenceDate! < t.occurrenceDate!,
          );
          if (d.selectedId && !d.tasks.some((x) => x.id === d.selectedId))
            d.selectedId = null;
          if (repeat !== "none") {
            const ruleId = crypto.randomUUID();
            d.rules.push({
              ...rule,
              id: ruleId,
              title: t.title,
              note: t.note,
              date: t.date,
              time: t.time,
              zone: t.zone,
              duration: t.duration,
              important: t.important,
              fixed: t.fixed,
              reminder: t.reminder,
              steps: t.steps.map((s) => ({ ...s, done: false })),
              kind: repeat,
              days,
              start: t.date!,
              enabled: true,
            });
            updated.ruleId = ruleId;
            updated.occurrenceDate = t.date;
          }
        }
        if (existing >= 0) {
          const index = d.tasks.findIndex((x) => x.id === t.id);
          d.tasks[index] = updated;
        } else d.tasks.push(updated);
        if (nowChoice) d.selectedId = updated.id;
        d.settings.onboarded = true;
        generateRepeats(d, time);
      },
      isNew ? "Дело добавлено" : "Изменения сохранены",
      modal?.revision,
    );
    if (result) {
      setModal(null);
      if (isNew) setJustAdded(t.id);
      if (nowChoice) navigate("now");
    }
    return result;
  };
  const taskMenu = (t: Task) => (
    <details className="task-menu">
      <summary aria-label={`Действия: ${t.title}`}>
        <MoreHorizontal size={20} />
      </summary>
      <div className="menu-actions">
        <button onClick={() => open("edit", t.id)}>Редактировать</button>
        <button onClick={() => open("move", t.id)}>Перенести</button>
        <button onClick={() => void moveTask(t, null, null)}>
          Убрать из сегодняшнего плана
        </button>
        <button onClick={() => void act(t, "cancel")}>Отменить дело</button>
        <button
          onClick={() =>
            void change((d) => {
              d.tasks = d.tasks.filter((x) => x.id !== t.id);
              if (d.selectedId === t.id) d.selectedId = null;
              if (t.ruleId) {
                d.tasks.push({
                  ...t,
                  status: "cancelled",
                  startedAt: null,
                  completedAt: null,
                  title: "Удалённое повторение",
                  deleted: true,
                  note: "",
                  steps: [],
                  reminder: "off",
                  updatedAt: Date.now(),
                });
              }
            }, "Дело удалено")
          }
        >
          Удалить
        </button>
      </div>
    </details>
  );
  const taskRow = (t: Task) => {
    const past = t.time && due(t)! < now;
    return (
      <article className="task-row" key={t.id}>
        <div className="task-time">
          {t.time ?? "—"}
          {t.fixed && <Lock size={14} aria-label="Время закреплено" />}
        </div>
        <div className="task-content">
          <h3>{t.title}</h3>
          <p className="meta">
            {t.status === "paused"
              ? "На паузе · "
              : t.status === "active"
                ? "В работе · "
                : ""}
            {t.duration
              ? `≈ ${t.duration} мин`
              : "Длительность пока неизвестна"}
            {t.important ? " · Важно в этот день" : ""}
            {t.ruleId ? " · Повторяется" : ""}
          </p>
          {past && (
            <p className="hint">Время прошло. Можно начать или перенести.</p>
          )}
          <div className="row-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                if (await act(t, "start")) navigate("now");
              }}
            >
              Начать <ArrowRight size={16} />
            </button>
            <button className="text-button" onClick={() => open("move", t.id)}>
              Перенести
            </button>
          </div>
        </div>
        {taskMenu(t)}
      </article>
    );
  };
  const todays = data.tasks.filter(
    (t) => openTask(t) && t.date === localDate(now, t.zone),
  );
  const previous = data.tasks.filter(
    (t) => openTask(t) && t.date && t.date < localDate(now, t.zone),
  );
  const done = data.tasks.filter(
    (t) =>
      t.completedAt && localDate(t.completedAt, data.settings.zone) === today,
  );
  const future = data.tasks
    .filter(
      (t) =>
        openTask(t) &&
        (!t.date || t.date > localDate(now, t.zone)) &&
        t.title
          .toLocaleLowerCase("ru")
          .includes(search.toLocaleLowerCase("ru")),
    )
    .sort(
      (a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999") || stable(a, b),
    );
  let body: ReactNode;
  if (!data.settings.onboarded) {
    body = (
      <section className="welcome card">
        {data.settings.fox && <Fox />}
        <p className="eyebrow">Одно дело. Один следующий шаг.</p>
        <h1>
          Не нужно держать
          <br />
          всё в голове
        </h1>
        <p className="lead muted">
          Запишите то, что крутится в мыслях.
          <br />С остальным разберёмся по ходу.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const task = makeTask(quick.trim(), Date.now(), data.settings.zone);
            if (
              await change((d) => {
                d.tasks.push(task);
                d.settings.onboarded = true;
              }, "Дело добавлено")
            ) {
              setQuick("");
              void store.drafts.delete("quick");
              setJustAdded(task.id);
            }
          }}
        >
          <label>
            {copy.title}
            <input
              value={quick}
              required
              maxLength={500}
              placeholder="Например, записаться к врачу"
              onChange={(e) => {
                setQuick(e.target.value);
                void store.drafts
                  .put({ id: "quick", value: e.target.value })
                  .catch(() => setError("Черновик не сохраняется"));
              }}
            />
          </label>
          <p className="hint">Сохранится в «Позже», без даты.</p>
          <button className="primary wide" disabled={busy}>
            {copy.add}
            <Plus size={19} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() =>
            void change((d) => {
              d.settings.onboarded = true;
            })
          }
        >
          Пока просто посмотреть <ArrowRight size={16} />
        </button>
      </section>
    );
  } else if (screen === "now") {
    body = (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Не всё сразу</p>
            <h1>Один следующий шаг</h1>
          </div>
          <span className="today-label">
            {new Date(now).toLocaleDateString("ru", {
              day: "numeric",
              month: "long",
              timeZone: data.settings.zone,
            })}
          </span>
        </div>
        {current ? (
          <section
            className={`focus-card card ${current.status === "active" ? "is-active" : ""}`}
          >
            <div className="focus-top">
              <span className="badge">
                <span className="status-dot" />
                {current.status === "active"
                  ? "В работе"
                  : current.status === "paused"
                    ? "Можно продолжить"
                    : "Сейчас"}
              </span>
              {data.settings.fox && (
                <Fox mood={current.status === "active" ? "working" : "calm"} />
              )}
            </div>
            <p className="hint reason">{selected.reason}</p>
            <h2>{current.title}</h2>
            <p className="meta">
              <Clock size={16} />
              {current.duration
                ? `Примерно ${current.duration} минут`
                : `Примерно ${data.settings.unknownDuration} минут — пока это ориентир`}
            </p>
            {!!current.steps.length && (
              <div className="current-step">
                <div className="step-label">
                  Шаг{" "}
                  {Math.min(
                    current.steps.filter((s) => s.done).length + 1,
                    current.steps.length,
                  )}{" "}
                  из {current.steps.length}
                </div>
                <h3>
                  {current.steps.find((s) => !s.done)?.title ??
                    "Все шаги готовы"}
                </h3>
                <div className="step-progress" aria-hidden="true">
                  {current.steps.map((s) => (
                    <span className={s.done ? "complete" : ""} key={s.id} />
                  ))}
                </div>
              </div>
            )}
            {current.status === "active" && data.settings.timer && (
              <p className="hint timer">
                В работе примерно {Math.floor(elapsed(current, now) / 60000)}{" "}
                мин · можно сделать паузу
              </p>
            )}
            <button
              className="primary wide focus-action"
              disabled={busy}
              onClick={() =>
                void act(
                  current,
                  current.status === "active"
                    ? current.steps.some((s) => !s.done)
                      ? "step"
                      : "complete"
                    : "start",
                )
              }
            >
              {current.status === "active" ? (
                <Check size={22} />
              ) : (
                <Play size={20} />
              )}{" "}
              {current.status === "active"
                ? current.steps.some((s) => !s.done)
                  ? "Шаг готов"
                  : "Дело готово"
                : current.status === "paused"
                  ? "Продолжить"
                  : "Начать"}
            </button>
            <div className="focus-secondary">
              {current.status === "active" ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act(current, "pause")}
                >
                  <Pause size={17} />
                  Пауза
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => open("help", current.id)}
                >
                  Не могу сейчас
                </button>
              )}
              <button
                className="text-button"
                onClick={() => open("move", current.id)}
              >
                Отложить
              </button>
              <button
                className="text-button"
                onClick={() => open("edit", current.id)}
              >
                Изменить
              </button>
            </div>
            {!!current.steps.length && (
              <details>
                <summary>Все шаги</summary>
                {current.status === "active" && (
                  <button
                    className="text-button"
                    onClick={() => void act(current, "complete")}
                  >
                    Завершить всё дело
                  </button>
                )}
                <ol className="all-steps">
                  {current.steps.map((s) => (
                    <li key={s.id} className={s.done ? "muted" : ""}>
                      {s.done ? "✓ " : ""}
                      {s.title}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {current.note && (
              <details>
                <summary>Заметка</summary>
                <p className="note-text">{current.note}</p>
              </details>
            )}
            {selected.conflict && (
              <div className="notice">
                Подошло закреплённое дело: {selected.conflict.title}
                <button onClick={() => void selectTask(selected.conflict!)}>
                  Поставить текущее на паузу и переключиться
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="card no-task">
            {data.settings.fox && <Fox mood={celebrate ? "done" : "rest"} />}
            <Empty title={selected.reason}>
              <p>
                Можно выбрать дело на сегодня
                <br />
                или оставить немного свободного места.
              </p>
              <button className="primary" onClick={() => open("add")}>
                Записать дело <Plus size={18} />
              </button>
            </Empty>
          </section>
        )}
        <button
          className="choose-button text-button"
          onClick={() => open("choose")}
        >
          Выбрать другое дело <ChevronRight size={17} />
        </button>
        <button className="recovery-entry" onClick={() => open("recovery")}>
          <span className="compass-icon">
            <Compass size={23} />
          </span>
          <span>
            <strong>Я потерялся</strong>
            <span>Спокойно пересоберём остаток дня</span>
          </span>
          <ArrowRight size={21} />
        </button>
        {!!previous.length && (
          <details className="earlier">
            <summary>Остались дела из предыдущих дней</summary>
            <p className="hint">
              Выбрать, что актуально? Можно продолжить сегодняшний день без
              разбора.
            </p>
            {previous.sort(stable).map(taskRow)}
          </details>
        )}
        <p className="bottom-note">Достаточно начать с одного действия.</p>
      </>
    );
  } else if (screen === "today") {
    const timed = todays
      .filter((t) => t.time)
      .sort((a, b) => due(a)! - due(b)! || stable(a, b));
    const untimed = todays.filter((t) => !t.time).sort(stable);
    body = (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">С местом для жизни</p>
            <h1>Сегодня</h1>
          </div>
          <button className="text-button" onClick={() => open("recovery")}>
            <Compass size={18} />
            Пересобрать
          </button>
        </div>
        <div className="now-line">
          <span />
          Сейчас {localTime(now, data.settings.zone)}
          <span />
        </div>
        {!todays.length && (
          <Empty title="Сегодня есть свободное место">
            <p>Выберите одно дело, которое вам подходит.</p>
            <button className="primary" onClick={() => open("add")}>
              Добавить дело
            </button>
          </Empty>
        )}
        {!!timed.length && (
          <section aria-label="Дела со временем" className="timeline">
            {timed.map(taskRow)}
          </section>
        )}
        {!!untimed.length && (
          <section>
            <h2 className="section-label">Без точного времени</h2>
            {untimed.map(taskRow)}
          </section>
        )}
        <details className="group">
          <summary>
            Готово сегодня{done.length ? ` · ${done.length}` : ""}
          </summary>
          {done.map((t) => (
            <div className="done-row" key={t.id}>
              <Check size={18} />
              <span>{t.title}</span>
              <button
                className="text-button"
                onClick={() =>
                  void change((d) => {
                    const x = d.tasks.find((x) => x.id === t.id)!;
                    x.status = "planned";
                    x.completedAt = null;
                    x.updatedAt = Date.now();
                  }, "Завершение отменено")
                }
              >
                Вернуть
              </button>
            </div>
          ))}
        </details>
        {!!previous.length && (
          <details className="group">
            <summary>Раньше</summary>
            {previous.sort(stable).map(taskRow)}
          </details>
        )}
      </>
    );
  } else {
    const groups = [...new Set(future.map((t) => t.date))];
    body = (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Пусть подождёт здесь</p>
            <h1>Позже</h1>
          </div>
          <Layers className="muted" />
        </div>
        <label className="search-label">
          <span className="sr-only">Поиск по названию</span>
          <input
            type="search"
            placeholder="Найти дело"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!future.length && (
          <Empty title={search ? "Ничего не нашлось" : "Место для будущих дел"}>
            <p>Записывайте без необходимости сразу планировать.</p>
          </Empty>
        )}
        {groups.map((date) => (
          <section key={date ?? "none"}>
            <h2 className="section-label">
              {date
                ? date === addDays(today, 1)
                  ? "Завтра"
                  : Temporal.PlainDate.from(date).toLocaleString("ru", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                : "Без даты"}
            </h2>
            {future.filter((t) => t.date === date).map(taskRow)}
          </section>
        ))}
        <details className="group">
          <summary>Отменённые дела</summary>
          {data.tasks
            .filter((t) => t.status === "cancelled" && !t.deleted)
            .map((t) => (
              <div className="done-row" key={t.id}>
                <span>{t.title}</span>
                <button
                  onClick={() =>
                    void change((d) => {
                      const x = d.tasks.find((x) => x.id === t.id)!;
                      x.status = "planned";
                      x.updatedAt = Date.now();
                    }, "Дело возвращено")
                  }
                >
                  Вернуть
                </button>
              </div>
            ))}
        </details>
      </>
    );
  }
  const relevantReminders = reminders
    .map((id) => data.tasks.find((t) => t.id === id))
    .filter(
      (t): t is Task =>
        !!t &&
        openTask(t) &&
        t.status !== "active" &&
        (!t.snoozeUntil || t.snoozeUntil <= now) &&
        t.reminder !== "off" &&
        due(t)! <=
          now +
            (t.reminder === "before" ? data.settings.beforeMinutes * 60000 : 0),
    );
  return (
    <div className={`app ${data.settings.reduceMotion ? "reduce-motion" : ""}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        К содержимому
      </a>
      <aside className="sidebar">
        <a className="brand" href="#now">
          <span className="brand-mark">
            с<span>·</span>
          </span>
          сейчас<span className="brand-dot">✦</span>
        </a>
        <p className="brand-sub">План, который на вашей стороне</p>
        <nav aria-label="Главные разделы">
          {(Object.entries(screens) as [Screen, string][]).map(
            ([key, label]) => (
              <a
                key={key}
                href={`#${key}`}
                className={screen === key ? "selected" : ""}
                aria-current={screen === key ? "page" : undefined}
              >
                {key === "now" ? (
                  <Circle size={21} />
                ) : key === "today" ? (
                  <CalendarDays size={21} />
                ) : (
                  <Layers size={21} />
                )}
                <span>{label}</span>
              </a>
            ),
          )}
        </nav>
        <button className="sidebar-add" onClick={() => open("add")}>
          <Plus size={20} />
          Добавить дело
        </button>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            {offlineReady
              ? "Готово к работе офлайн"
              : "Данные на этом устройстве"}
          </div>
          <button className="settings-button" onClick={() => open("settings")}>
            <SettingsIcon size={19} />
            Настройки
          </button>
        </div>
      </aside>
      <header className="mobile-header">
        <a href="#now" className="brand">
          сейчас<span className="brand-dot">✦</span>
        </a>
        <button
          className="icon-button"
          aria-label="Настройки"
          onClick={() => open("settings")}
        >
          <SettingsIcon size={22} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="topline">
          <span>Меньше держать в голове. Больше быть здесь.</span>
          <span className="local-label">
            <span className="status-dot" />
            Сохраняется на устройстве
          </span>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <p>{error}</p>
            <button onClick={() => void exportData(data)}>
              Скачать доступную копию
            </button>
            <button onClick={() => setError("")}>Закрыть сообщение</button>
          </div>
        )}
        {needRefresh && (
          <div className="notice">
            Доступно обновление.{" "}
            {active
              ? "Примените его после паузы или завершения дела."
              : "Данные и сохранённый черновик останутся на месте."}
            <button
              disabled={!!active || busy || !!modal}
              onClick={async () => {
                await store.drafts.count();
                void updateServiceWorker(true);
              }}
            >
              Обновить приложение
            </button>
          </div>
        )}
        {!!relevantReminders.length && (
          <aside aria-label="Напоминание" className="notice reminder">
            <p role="status">
              {late
                ? "Пока вас не было, подошли запланированные дела."
                : relevantReminders.length > 1
                  ? "Подошло время нескольких дел."
                  : `Пора: ${relevantReminders[0].title}`}
            </p>
            <div className="row-actions">
              <button
                onClick={async () => {
                  if (await act(relevantReminders[0], "start")) {
                    setReminders([]);
                    navigate("now");
                  }
                }}
              >
                Начать
              </button>
              <button
                onClick={() => {
                  const t = relevantReminders[0];
                  const later = Date.now() + 5 * 60000;
                  void moveTask(
                    t,
                    localDate(later, t.zone),
                    localTime(later, t.zone),
                    later,
                  );
                }}
              >
                Через 5 минут
              </button>
              <button onClick={() => open("help", relevantReminders[0].id)}>
                Не могу сейчас
              </button>
              <button onClick={() => setReminders([])}>Закрыть</button>
            </div>
          </aside>
        )}
        {justAdded && data.tasks.some((t) => t.id === justAdded) && (
          <div className="notice first-action">
            <p>Дело записано. Можно начать с него сейчас.</p>
            <button
              onClick={async () => {
                const t = data.tasks.find((t) => t.id === justAdded)!;
                if (await act(t, "start")) {
                  setJustAdded(null);
                  navigate("now");
                }
              }}
            >
              Начать сейчас
            </button>
            <button className="text-button" onClick={() => setJustAdded(null)}>
              Оставить на потом
            </button>
          </div>
        )}
        {body}
        {celebrate && (
          <span className="spark-feedback" role="status">
            ✦ Ещё один маленький шаг
          </span>
        )}
        {(toast || (snapshot.undo && dismissedUndo !== snapshot.revision)) && (
          <div className="toast" role="status">
            <span>{toast || snapshot.undo?.label}</span>
            {snapshot.undo && (
              <button
                aria-label="Отменить последнее действие"
                onClick={async () => {
                  try {
                    setSnapshot(await store.undo(snapshot.revision));
                    setToast("Действие отменено");
                    setJustAdded(null);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <RotateCcw size={16} />
                Отменить
              </button>
            )}
            <button
              className="toast-close"
              aria-label="Скрыть сообщение"
              onClick={() => {
                setToast("");
                setDismissedUndo(snapshot.revision);
              }}
            >
              ×
            </button>
          </div>
        )}
      </main>
      <button
        className="mobile-add"
        aria-label="Добавить дело"
        onClick={() => open("add")}
      >
        <Plus size={24} />
      </button>
      {modal && (
        <Dialog
          title={
            modal.kind === "add"
              ? "Записать дело"
              : modal.kind === "edit"
                ? "Изменить дело"
                : modal.kind === "settings"
                  ? "Настройки"
                  : modal.kind === "recovery"
                    ? "Можно начать отсюда"
                    : modal.kind === "choose"
                      ? "Выбрать следующее дело"
                      : modal.kind === "move"
                        ? "Можно перенести"
                        : "Сделаем начало проще"
          }
          onClose={() => setModal(null)}
        >
          {(modal.kind === "add" || modal.kind === "edit") && (
            <TaskForm
              key={modal.id ?? "new"}
              task={modalTask}
              data={data}
              context={screen}
              onSave={saveTask}
            />
          )}
          {modal.kind === "settings" && (
            <SettingsPanel
              data={data}
              revision={snapshot.revision}
              onChange={(patch) =>
                change((d) => {
                  Object.assign(d.settings, patch);
                })
              }
              onRestore={async (imported, expected) => {
                try {
                  const next = await store.restore(imported, expected);
                  setSnapshot(next);
                  setToast("");
                  setJustAdded(null);
                  setReminders([]);
                  return true;
                } catch (err) {
                  setError((err as Error).message);
                  return false;
                }
              }}
            />
          )}
          {modal.kind === "recovery" && (
            <Recovery
              data={data}
              revision={snapshot.revision}
              onApply={async (plan) => {
                if (
                  await change(
                    (d) => applyPlan(d, plan, snapshot.revision, Date.now()),
                    "План пересобран",
                  )
                ) {
                  setModal(null);
                  navigate("now");
                  return true;
                }
                return false;
              }}
            />
          )}
          {modal.kind === "choose" && (
            <div className="choose-list">
              {active && (
                <p className="hint">
                  При выборе другого дела текущее будет поставлено на паузу.
                </p>
              )}
              {todays.length ? (
                todays.map((t) => (
                  <button key={t.id} onClick={() => void selectTask(t)}>
                    <span>{t.title}</span>
                    <span className="hint">{t.time ?? "Без времени"}</span>
                    <ArrowRight size={18} />
                  </button>
                ))
              ) : (
                <p>
                  На сегодня пока нет дел. Можно добавить новое или начать дело
                  из «Позже».
                </p>
              )}
              <button
                onClick={() => {
                  setModal(null);
                  navigate("later");
                }}
              >
                Посмотреть «Позже»
              </button>
            </div>
          )}
          {modal.kind === "move" && modalTask && (
            <Move
              task={modalTask}
              onMove={(date, time, snooze) =>
                moveTask(modalTask, date, time, snooze)
              }
            />
          )}
          {modal.kind === "help" && modalTask && (
            <div className="help-panel">
              <p className="lead">Не обязательно начинать со всего дела.</p>
              <p>
                Запишите одно физически понятное действие — например, «Найти
                номер клиники».
              </p>
              <button
                className="primary wide"
                onClick={() => open("edit", modalTask.id)}
              >
                Сделать первый шаг проще
              </button>
              <button onClick={() => open("move", modalTask.id)}>
                Перенести
              </button>
              <button onClick={() => void moveTask(modalTask, null, null)}>
                Убрать из сегодняшнего плана
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
function Move({
  task,
  onMove,
}: {
  task: Task;
  onMove: (
    date: string | null,
    time: string | null,
    snooze?: number | null,
  ) => Promise<boolean>;
}) {
  const [date, setDate] = useState(
    task.date ?? localDate(Date.now(), task.zone),
  );
  const [time, setTime] = useState(task.time ?? "");
  const [error, setError] = useState("");
  return (
    <div className="move-panel">
      <p>
        {task.fixed
          ? "Вы переносите закреплённое время этого дела."
          : "Можно выбрать более подходящий момент."}
      </p>
      <div className="chips">
        {[5, 15, 30, 60].map((minutes) => (
          <button
            key={minutes}
            onClick={() => {
              const later = Date.now() + minutes * 60000;
              void onMove(
                localDate(later, task.zone),
                localTime(later, task.zone),
                later,
              );
            }}
          >
            Через {minutes === 60 ? "час" : `${minutes} минут`}
          </button>
        ))}
        <button
          onClick={() =>
            void onMove(addDays(localDate(Date.now(), task.zone), 1), null)
          }
        >
          Завтра
        </button>
        <button onClick={() => void onMove(null, null)}>Без даты</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!date) throw new Error("Выберите дату");
            at(date, time || "12:00", task.zone);
            void onMove(date, time || null);
          } catch {
            setError("Проверьте дату и время");
          }
        }}
      >
        <div className="field-row">
          <label>
            Дата
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Время
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <button className="primary wide">Перенести на выбранный момент</button>
      </form>
    </div>
  );
}
