import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const title =
  "Позвонить в страховую компанию и уточнить, какие документы необходимо предоставить для продления договора";
async function start(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-05T07:00:00Z"));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Не нужно держать всё в голове" }),
  ).toBeVisible();
}
async function skip(page: Page) {
  await start(page);
  await page.getByRole("button", { name: "Пока просто посмотреть" }).click();
}
const visibleButton = (page: Page, name: string) =>
  page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .first();
async function add(
  page: Page,
  name: string,
  steps: string[] = [],
  when = "Сегодня",
) {
  await visibleButton(page, "Добавить дело").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Что нужно сделать?").fill(name);
  await dialog.getByRole("button", { name: when, exact: true }).click();
  if (steps.length) {
    await dialog.getByText("Дополнительно", { exact: true }).click();
    for (let i = 0; i < steps.length; i++) {
      await dialog
        .getByRole("button", { name: "Добавить шаг", exact: true })
        .click();
      await dialog.getByLabel(`Шаг ${i + 1}`, { exact: true }).fill(steps[i]);
    }
  }
  await dialog
    .getByRole("button", { name: "Добавить дело", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
test("первая минута: запись, начало, завершение, reload, отмена", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Что нужно сделать?").fill("Открыть письмо");
  await page
    .locator(".welcome")
    .getByRole("button", { name: "Добавить дело", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Начать сейчас", exact: true })
    .click();
  await page.getByRole("button", { name: "Дело готово", exact: true }).click();
  await page.reload();
  await page.getByRole("link", { name: "Сегодня", exact: true }).click();
  await page.getByText("Готово сегодня", { exact: false }).click();
  await expect(page.getByText("Открыть письмо", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Отменить последнее действие" })
    .click();
  await page.getByRole("link", { name: "Сейчас", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Дело готово", exact: true }),
  ).toBeVisible();
});
test("три шага, пауза, восстановление, правка и перенос", async ({ page }) => {
  await skip(page);
  await add(page, "Собрать документы", [
    "Найти папку",
    "Выбрать документы",
    "Положить в сумку",
  ]);
  await page
    .getByRole("button", { name: "Начать сейчас", exact: true })
    .click();
  await page.getByRole("button", { name: "Шаг готов", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Выбрать документы" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.getByRole("button", { name: "Шаг готов", exact: true }).click();
  await page.getByRole("button", { name: "Шаг готов", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Сейчас нет выбранного дела" }),
  ).toBeVisible();
  await add(page, "Редактируем");
  await page.getByRole("button", { name: "Оставить на потом" }).click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Что нужно сделать?")
    .fill("Новое название");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(
    page.getByRole("heading", { name: "Новое название" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отложить", exact: true }).click();
  await page
    .getByRole("button", { name: "Через 15 минут", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Следующее дело в 10:15" }),
  ).toBeVisible();
});
test("черновик, Escape, фокус, диалог доступен", async ({ page }) => {
  await skip(page);
  const trigger = visibleButton(page, "Добавить дело");
  await trigger.click();
  await page
    .getByRole("dialog")
    .getByLabel("Что нужно сделать?")
    .fill("Не потерять черновик");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.reload();
  await visibleButton(page, "Добавить дело").click();
  await expect(
    page.getByRole("dialog").getByLabel("Что нужно сделать?"),
  ).toHaveValue("Не потерять черновик");
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
});
test("пересборка показывает изменения, применяется и отменяется", async ({
  page,
}) => {
  await skip(page);
  await add(page, "Посильное дело");
  await page.getByRole("button", { name: "Оставить на потом" }).click();
  await page.getByRole("button", { name: /Я потерялся/ }).click();
  await expect(page.getByText("Без времени → 10:00")).toBeVisible();
  await page.getByRole("button", { name: "Применить этот план" }).click();
  await expect(page.getByText("Запланировано на 10:00")).toBeVisible();
  await page
    .getByRole("button", { name: "Отменить последнее действие" })
    .click();
  await expect(page.getByText("Есть место для небольшого шага")).toBeVisible();
});
test("экспорт, проверенный импорт и отказ от неправильного файла", async ({
  page,
}) => {
  await skip(page);
  await add(page, "Дело для резервной копии");
  await visibleButton(page, "Настройки").click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать резервную копию", exact: true })
    .click();
  const download = await downloadPromise;
  const raw = await readFile((await download.path())!);
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.getByText(/Файл не подходит/)).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: raw,
  });
  await expect(page.getByText(/В копии 1 дел/)).toBeVisible();
  await page.getByLabel("Я понимаю, что текущие данные будут заменены").check();
  await page
    .getByRole("button", { name: "Восстановить данные", exact: true })
    .click();
  await expect(
    page.getByText("Данные восстановлены", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Дело для резервной копии" }),
  ).toBeVisible();
});
test("сенсорные настройки и отказ в уведомлениях не мешают делам", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(Notification, "permission", { get: () => "denied" }),
  );
  await skip(page);
  await visibleButton(page, "Добавить дело").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Что нужно сделать?").fill("Напомнить");
  await dialog.getByRole("button", { name: "Сегодня", exact: true }).click();
  await dialog.getByLabel("Время, если нужно").fill("10:30");
  await dialog.getByLabel("Напомнить", { exact: true }).selectOption("at");
  await dialog
    .getByRole("button", { name: "Добавить дело", exact: true })
    .click();
  await visibleButton(page, "Настройки").click();
  await page.getByRole("switch", { name: "Показывать лисёнка" }).click();
  await expect(
    page.getByRole("switch", { name: "Показывать лисёнка" }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: "Искры за маленькие шаги" }).click();
  await expect(
    page.getByRole("switch", { name: "Искры за маленькие шаги" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Тихие звуки" }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Включить системные уведомления" })
    .click();
  await expect(
    page.getByText(/Уведомления отключены в настройках браузера/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page
    .getByRole("button", { name: "Начать сейчас", exact: true })
    .click();
  await page.getByRole("button", { name: "Дело готово", exact: true }).click();
  await expect(page.getByRole("img", { name: /Лисёнок/ })).toHaveCount(0);
});
test("серии: только это дело и это и будущие", async ({ page }) => {
  await skip(page);
  await visibleButton(page, "Добавить дело").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Что нужно сделать?").fill("Ежедневное");
  await dialog.getByRole("button", { name: "Сегодня", exact: true }).click();
  await dialog.getByText("Дополнительно", { exact: true }).click();
  await dialog.getByLabel("Повторение", { exact: true }).selectOption("daily");
  await dialog
    .getByRole("button", { name: "Добавить дело", exact: true })
    .click();
  await page.getByRole("button", { name: "Оставить на потом" }).click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Что нужно сделать?").fill("Только сегодняшнее");
  await dialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.getByRole("link", { name: "Позже", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ежедневное", exact: true }),
  ).toHaveCount(13);
  await page.getByRole("link", { name: "Сейчас", exact: true }).click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Изменить", { exact: true }).selectOption("future");
  await dialog.getByLabel("Что нужно сделать?").fill("Обновлённая серия");
  await dialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.getByRole("link", { name: "Позже", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Обновлённая серия", exact: true }),
  ).toHaveCount(13);
  await expect(
    page.getByRole("heading", { name: "Ежедневное", exact: true }),
  ).toHaveCount(0);
});
test("production: ресурсы, manifest, область SW и ранее не открытый раздел офлайн", async ({
  page,
  context,
}) => {
  const failed: string[] = [];
  page.on("pageerror", (e) => failed.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  await skip(page);
  await add(page, "Доступно без сети", [], "Без даты");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const manifestUrl = await page
    .locator("link[rel=manifest]")
    .getAttribute("href");
  expect(manifestUrl).toContain("/I_HAVE_A_PLAN/");
  const manifest = await (await page.request.get(manifestUrl!)).json();
  expect(manifest.scope).toBe("/I_HAVE_A_PLAN/");
  expect(manifest.icons).toHaveLength(3);
  await context.setOffline(true);
  await page.goto("./#later");
  await expect(
    page.getByRole("heading", { name: "Доступно без сети" }),
  ).toBeVisible();
  await visibleButton(page, "Добавить дело").click();
  await page
    .getByRole("dialog")
    .getByLabel("Что нужно сделать?")
    .fill("Записано офлайн");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить дело", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Записано офлайн" }),
  ).toBeVisible();
  expect(failed).toEqual([]);
});
test("длинная строка, заметка, крупный текст и уменьшение движения", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skip(page);
  await add(page, "ДлиннаяСтрока".repeat(35));
  await page.getByRole("button", { name: "Оставить на потом" }).click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByLabel("Заметка", { exact: true })
    .fill("Заметка ".repeat(1000));
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.addStyleTag({ content: "body {font-size:32px}" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("Заметка", { exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const [width, height] of [
  [320, 800],
  [390, 844],
  [768, 1024],
  [834, 1194],
  [1024, 768],
  [1440, 1024],
])
  test(`визуальная проверка ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await skip(page);
    await add(page, title, [
      "Найти номер страховой",
      "Подготовить номер договора",
      "Позвонить",
    ]);
    await page
      .getByRole("button", { name: "Начать сейчас", exact: true })
      .click();
    await page.getByRole("button", { name: "Скрыть сообщение" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
    await mkdir("test-results/screens", { recursive: true });
    await page.screenshot({
      path: `test-results/screens/now-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await page.screenshot({
      path: `test-results/screens/form-${width}.png`,
      fullPage: true,
    });
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
  });
if (!process.env.APP_URL)
  test("обновление SW сохраняет дело и черновик", async ({ page }) => {
    await skip(page);
    await add(page, "Сохранить при обновлении");
    await page.getByRole("button", { name: "Оставить на потом" }).click();
    await visibleButton(page, "Добавить дело").click();
    await page
      .getByRole("dialog")
      .getByLabel("Что нужно сделать?")
      .fill("Черновик перед обновлением");
    await page.keyboard.press("Escape");
    await page.evaluate(() => navigator.serviceWorker.ready);
    const original = await readFile("dist/sw.js", "utf8");
    try {
      await writeFile(
        "dist/sw.js",
        `${original}\n// update-test-${Date.now()}\n`,
      );
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update();
      });
      await expect(
        page.getByRole("button", { name: "Обновить приложение" }),
      ).toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "Обновить приложение" }).click();
      await expect(
        page.getByRole("heading", { name: "Сохранить при обновлении" }),
      ).toBeVisible();
      await visibleButton(page, "Добавить дело").click();
      await expect(
        page.getByRole("dialog").getByLabel("Что нужно сделать?"),
      ).toHaveValue("Черновик перед обновлением");
    } finally {
      await writeFile("dist/sw.js", original);
    }
  });
