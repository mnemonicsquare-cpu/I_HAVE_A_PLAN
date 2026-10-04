import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export const copy = {
  name: "Сейчас",
  add: "Добавить дело",
  title: "Что нужно сделать?",
  recovery: "Я потерялся",
  reminders:
    "Напоминания работают, пока приложение активно. Когда оно закрыто, сигнал может не прийти",
  about:
    "«Сейчас» — инструмент планирования и организации. Он не предназначен для диагностики или лечения СДВГ и не заменяет консультацию специалиста",
};
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    heading.current?.focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-top">
        <h2 id="dialog-title" tabIndex={-1} ref={heading}>
          {title}
        </h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Fox({
  mood = "calm",
}: {
  mood?: "calm" | "working" | "done" | "recovery" | "rest";
}) {
  return (
    <svg
      className={`fox fox-${mood}`}
      width="100"
      height="100"
      viewBox="0 0 100 100"
      role="img"
      aria-label={
        {
          calm: "Лисёнок рядом",
          working: "Лисёнок сосредоточен",
          done: "Лисёнок радуется",
          recovery: "Лисёнок поддерживает",
          rest: "Лисёнок отдыхает",
        }[mood]
      }
    >
      <path
        d="M18 62 10 21 38 34 51 29 65 34 91 19 83 62 64 83 37 82Z"
        fill="#ff7a1a"
      />
      <path d="m17 30 7 22 10-13ZM82 29 68 40 78 52Z" fill="#843e24" />
      <path d="m19 59 18-8 13 16 14-16 19 8-19 22H37Z" fill="#ffe5c8" />
      <path d="m46 66 9 0-4 6Z" fill="#242329" />
      {mood === "rest" || mood === "done" ? (
        <path
          d="m31 55 8-2m24 0 8 2"
          stroke="#242329"
          strokeWidth="4"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M35 50v6m32-6v6"
            stroke="#242329"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      <path
        d="m46 77 5 2 6-3"
        fill="none"
        stroke="#84462a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit" aria-hidden="true">
        ○
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
