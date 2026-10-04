import { useState } from "react";
import { initialData, parseImport, type Data, type Settings } from "./domain";
import { exportData } from "./storage";
import { enableNotifications, chime } from "./services";
import { copy } from "./ui";
export function SettingsPanel({
  data,
  revision,
  onChange,
  onRestore,
}: {
  data: Data;
  revision: number;
  onChange: (patch: Partial<Settings>) => Promise<boolean>;
  onRestore: (data: Data, expected: number) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [importRevision, setImportRevision] = useState(revision);
  const [imported, setImported] = useState<Data | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reset, setReset] = useState("");
  const s = data.settings;
  return (
    <div className="settings-panel">
      <h3>Как вам спокойнее</h3>
      {(
        [
          ["fox", "Показывать лисёнка"],
          ["effects", "Искры за маленькие шаги"],
          ["sound", "Тихие звуки"],
          ["timer", "Показывать время в работе"],
          ["reduceMotion", "Уменьшить движение"],
        ] as const
      ).map(([key, label]) => (
        <label className="check setting" key={key}>
          <span>{label}</span>
          <input
            type="checkbox"
            role="switch"
            checked={s[key]}
            onChange={(e) => {
              if (key === "sound" && e.target.checked) chime(true);
              void onChange({ [key]: e.target.checked });
            }}
          />
        </label>
      ))}
      <p className="hint">
        Звуки выключены по умолчанию. Системное ограничение движения учитывается
        автоматически.
      </p>
      {s.effects && (
        <p className="spark-total">
          ✦ {data.rewards.length} искр{" "}
          <span className="hint">Без норм, серий и потерь за отсутствие.</span>
        </p>
      )}
      <h3>Свободное место в дне</h3>
      <label>
        Планировать до
        <input
          type="time"
          value={s.end}
          required
          onChange={(e) => {
            if (e.target.value) void onChange({ end: e.target.value });
          }}
        />
      </label>
      <div className="field-row">
        <label>
          Переход между делами, минут
          <input
            type="number"
            min={0}
            max={60}
            defaultValue={s.buffer}
            onBlur={(e) => void onChange({ buffer: Number(e.target.value) })}
          />
        </label>
        <label>
          Если длительность неизвестна
          <input
            type="number"
            min={1}
            max={120}
            defaultValue={s.unknownDuration}
            onBlur={(e) =>
              void onChange({ unknownDuration: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label>
        Заполнять свободное время не более чем на
        <select
          value={s.capacity}
          onChange={(e) => void onChange({ capacity: Number(e.target.value) })}
        >
          {[0.3, 0.5, 0.7, 0.8, 1].map((v) => (
            <option value={v} key={v}>
              {Math.round(v * 100)}%
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Это ориентиры для предложения плана. Его всегда можно изменить.
      </p>
      <h3>Напоминания</h3>
      <p>{copy.reminders}</p>
      <div className="field-row">
        <label>
          Заранее, минут
          <input
            type="number"
            min={1}
            max={60}
            defaultValue={s.beforeMinutes}
            onBlur={(e) =>
              void onChange({ beforeMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Повторять через, минут
          <input
            type="number"
            min={1}
            max={60}
            defaultValue={s.repeatMinutes}
            onBlur={(e) =>
              void onChange({ repeatMinutes: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.privateNotifications}
          onChange={(e) =>
            void onChange({ privateNotifications: e.target.checked })
          }
        />
        Скрывать название в системном уведомлении
      </label>
      {data.tasks.some((t) => t.reminder !== "off") ? (
        <button onClick={() => void enableNotifications().then(setMessage)}>
          Включить системные уведомления
        </button>
      ) : (
        <p className="hint">
          Сначала добавьте напоминание к делу с датой и временем.
        </p>
      )}
      <h3>Ваши данные</h3>
      <p>
        Дела хранятся в этом браузере на этом устройстве. Очистка браузера может
        их удалить. Для другого устройства используйте резервную копию.
      </p>
      <button onClick={() => void exportData(data)}>
        Скачать резервную копию
      </button>
      <label className="file-label">
        Восстановить из JSON
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            setImported(null);
            setConfirmed(false);
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 5_000_000) throw new Error("Файл больше 5 МБ");
              setImported(parseImport(await file.text()));
              setImportRevision(revision);
              setMessage("");
            } catch (err) {
              setMessage(
                err instanceof Error
                  ? err.message
                  : "Не удалось прочитать файл",
              );
            }
            e.target.value = "";
          }}
        />
      </label>
      {imported && (
        <div className="notice">
          <h4>Заменить текущие данные?</h4>
          <p>
            В копии {imported.tasks.length} дел, {imported.rules.length} серий.
            Текущие {data.tasks.length} дел будут заменены.
          </p>
          <button onClick={() => void exportData(data)}>
            Сначала скачать текущую копию
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Я понимаю, что текущие данные будут заменены
          </label>
          <button
            className="primary"
            disabled={!confirmed}
            onClick={async () => {
              if (await onRestore(imported, importRevision)) {
                setImported(null);
                setMessage("Данные восстановлены");
              }
            }}
          >
            Восстановить данные
          </button>
          <button className="text-button" onClick={() => setImported(null)}>
            Не сейчас
          </button>
        </div>
      )}
      {"storage" in navigator &&
        "persist" in navigator.storage &&
        data.tasks.length > 0 && (
          <button
            onClick={async () => {
              try {
                const kept = await navigator.storage.persist();
                setMessage(
                  kept
                    ? "Браузер предоставил устойчивое хранение. Резервная копия всё равно нужна"
                    : "Браузер не предоставил устойчивое хранение. Скачивайте резервную копию",
                );
              } catch {
                setMessage("Не удалось запросить устойчивое хранение");
              }
            }}
          >
            Попросить браузер сохранять данные дольше
          </button>
        )}
      <details>
        <summary>Удалить все данные</summary>
        <p>
          Это удалит дела, настройки и черновики в этом браузере. Сначала
          скачайте копию.
        </p>
        <label>
          Для подтверждения введите УДАЛИТЬ
          <input value={reset} onChange={(e) => setReset(e.target.value)} />
        </label>
        <button
          disabled={reset !== "УДАЛИТЬ"}
          onClick={async () => {
            if (await onRestore(initialData(), revision)) {
              setReset("");
              setMessage("Данные удалены");
            }
          }}
        >
          Удалить всё
        </button>
      </details>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <h3>Установка на телефон</h3>
      <p>
        В меню браузера найдите «Установить приложение» или «На главный экран»,
        если такой пункт доступен. На iPhone в Safari: «Поделиться» → «На экран
        Домой». Можно пользоваться и обычной вкладкой.
      </p>
      <h3>О приложении</h3>
      <p>{copy.about}</p>
      <p className="hint">
        Версия 1.0 · Без регистрации, рекламы и аналитики. Содержание дел не
        отправляется на сервер. Хостинг получает обычные запросы загрузки сайта.
        Локальное хранение не является шифрованием.
      </p>
      <a
        href="https://github.com/mnemonicsquare-cpu/I_HAVE_A_PLAN"
        target="_blank"
        rel="noreferrer"
      >
        Открытый код и документация ↗
      </a>
    </div>
  );
}
