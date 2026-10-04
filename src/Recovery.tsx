import { useState } from "react";
import { rebuild, type Data, type Plan } from "./domain";
import { Fox } from "./ui";
export function Recovery({
  data,
  revision,
  onApply,
}: {
  data: Data;
  revision: number;
  onApply: (plan: Plan) => Promise<boolean>;
}) {
  const [end, setEnd] = useState(data.settings.end);
  const [target, setTarget] = useState<"tomorrow" | "later">("tomorrow");
  const [plan, setPlan] = useState(() => rebuild(data, Date.now(), revision));
  const title = (id: string) =>
    data.tasks.find((t) => t.id === id)?.title ?? "Дело";
  const calculate = (nextEnd = end, nextTarget = target) =>
    setPlan(rebuild(data, Date.now(), revision, nextEnd, nextTarget));
  return (
    <div className="recovery">
      {data.settings.fox && <Fox mood="recovery" />}
      <p className="lead">
        План можно пересобрать.
        <br />
        Начнём с того, что помещается.
      </p>
      <div className="field-row">
        <label>
          Сегодня — до
          <input
            type="time"
            value={end}
            onChange={(e) => {
              if (e.target.value) {
                setEnd(e.target.value);
                calculate(e.target.value);
              }
            }}
          />
        </label>
        <label>
          Остальное —
          <select
            value={target}
            onChange={(e) => {
              const value = e.target.value as typeof target;
              setTarget(value);
              calculate(end, value);
            }}
          >
            <option value="tomorrow">На завтра</option>
            <option value="later">В «Позже» без даты</option>
          </select>
        </label>
      </div>
      <p className="hint">
        Оставляем пространство для пауз. Неизвестная длительность — примерно{" "}
        {data.settings.unknownDuration} минут.
      </p>
      {plan.afterHours && (
        <p className="notice">
          Доступный день уже закончился. Можно отдохнуть или самостоятельно
          выбрать одно небольшое дело на «Сейчас».
        </p>
      )}
      {!!plan.conflicts.length && (
        <div className="notice">
          <h3>Есть пересечение закреплённых дел</h3>
          <p>Время этих дел оставим вам на выбор:</p>
          <ul>
            {plan.conflicts.map((id) => (
              <li key={id}>{title(id)}</li>
            ))}
          </ul>
        </div>
      )}
      {!!plan.importantOverflow.length && (
        <p className="notice">
          Не помещаются важные дела:{" "}
          {plan.importantOverflow.map(title).join("; ")}. Можно увеличить
          доступное время или согласиться с предложенным переносом.
        </p>
      )}
      {!!plan.fixed.length && (
        <details>
          <summary>Останутся на месте: {plan.fixed.length}</summary>
          <ul>
            {plan.fixed.map((id) => (
              <li key={id}>{title(id)}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="plan-changes">
        {plan.changes.map((c) => {
          const old = data.tasks.find((t) => t.id === c.id)!;
          return (
            <div className="plan-change" key={c.id}>
              <strong>{title(c.id)}</strong>
              <span>
                {old.time ?? "Без времени"} →{" "}
                {c.time ?? (c.date ? "Завтра" : "Позже, без даты")}
              </span>
            </div>
          );
        })}
      </div>
      {!plan.changes.length ? (
        <p className="notice">
          Сейчас нечего перестраивать. Можно вернуться к одному следующему
          действию.
        </p>
      ) : (
        <button
          className="primary wide"
          onClick={async () => {
            if (!(await onApply(plan))) calculate();
          }}
        >
          Применить этот план
        </button>
      )}
      <button className="text-button" onClick={() => calculate()}>
        Пересчитать предложение
      </button>
      <p className="hint">
        Ничего не удаляется. Последнюю пересборку можно отменить.
      </p>
    </div>
  );
}
