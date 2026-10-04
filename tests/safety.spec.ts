import { test, expect, type Page } from "@playwright/test";
async function init(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Пока просто посмотреть" }).click();
}
async function add(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Добавить дело", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Что нужно сделать?").fill(name);
  await d.getByRole("button", { name: "Сегодня", exact: true }).click();
  await d.getByRole("button", { name: "Добавить дело", exact: true }).click();
  await expect(d).not.toBeVisible();
  await page.getByRole("button", { name: "Оставить на потом" }).click();
}
test("удаление отменяется, ручной выбор и клавиатура работают", async ({
  page,
}) => {
  await init(page);
  await add(page, "Первое дело");
  await add(page, "Второе дело");
  await page.getByRole("button", { name: "Выбрать другое дело" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Второе дело/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Второе дело" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Сегодня", exact: true }).click();
  await page.getByLabel("Действия: Первое дело").click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Первое дело", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Отменить последнее действие" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Первое дело", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Home");
  await page.getByRole("link", { name: "К содержимому" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true }),
  ).toBeVisible();
});
test("старый черновик не затирает изменения другой вкладки", async ({
  page,
  context,
}) => {
  await init(page);
  await add(page, "Общее дело");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Что нужно сделать?")
    .fill("Старый черновик");
  await page.keyboard.press("Escape");
  const other = await context.newPage();
  await other.goto("./");
  await other.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(
    other.getByRole("button", { name: "Дело готово", exact: true }),
  ).toBeVisible();
  await page.bringToFront();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(
    page.getByText(/После создания черновика дело изменилось/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить изменения" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Загрузить актуальное дело" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Что нужно сделать?"),
  ).toHaveValue("Общее дело");
  await other.close();
});
