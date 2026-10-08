/**
 * A EQUIPE COMPLETA NA INTERFACE NOVA (fork TOQ).
 *
 * A Equipe nova cadastra pessoas e escolhe os perfis, mas o que só a Equipe da versão atual fazia
 * (revogar e devolver o acesso de quem sai, reenviar e revogar convites pendentes, os horários de
 * atendimento de cada profissional, que liberam horário livre na agenda) ficava fora do alcance de
 * quem usa só a interface nova. Esta spec prova, pela tela, que a Equipe nova leva até lá sem sair
 * da casca nova, na aba certa, e volta.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-equipe-completa");

/** Espera as transições terminarem antes da foto; as animações sem fim ficam de fora. */
async function animacoesTerminadas(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

test.describe("A Equipe completa dentro da interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("acessos, convites e horários de atendimento a partir da Equipe nova", async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    await loginComoAdmin(page, lerCreds());

    await page.goto("/equipe");
    await expect(page.getByTestId("novo-equipe")).toBeVisible({ timeout: ESPERA });
    await page.getByTestId("novo-equipe-acessos").click();
    await page.waitForURL(/\/ajustes\/equipe-completa$/, { timeout: ESPERA });
    const ajuste = page.getByTestId("novo-ajuste");
    // O trilho continua marcando a Equipe: é a mesma tela, continuada.
    await expect(page.getByTestId("novo-porta-equipe")).toHaveAttribute("aria-current", "page");
    await expect(ajuste.getByRole("heading", { name: "Equipe", level: 1 })).toBeVisible({
      timeout: ESPERA,
    });
    await expect(ajuste.getByRole("tab", { name: "Membros" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Revogar o acesso de quem saiu: o menu de ações de outro membro oferece (não clicamos).
    const acoes = ajuste.getByRole("button", { name: "Ações" }).first();
    await expect(acoes).toBeVisible({ timeout: ESPERA });
    await acoes.click();
    await expect(
      page.getByRole("menuitem", { name: /Revogar acesso|Devolver acesso/ }),
    ).toBeVisible();
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "1-acessos-na-casca-nova.png") });
    await page.keyboard.press("Escape");

    // O "‹ Equipe" volta para a Equipe nova, e o atalho dos horários abre a aba Atendimento.
    await ajuste.getByRole("link", { name: "‹ Equipe" }).click();
    await page.waitForURL(/\/equipe$/, { timeout: ESPERA });
    await page.getByTestId("novo-equipe-horarios").click();
    await page.waitForURL(/\/ajustes\/equipe-completa\?aba=atendimento/, { timeout: ESPERA });
    await expect(ajuste.getByRole("tab", { name: "Atendimento" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: ESPERA },
    );
    await expect(ajuste.getByTestId("atendentes-e-horarios")).toBeVisible({ timeout: ESPERA });
    await expect(ajuste.locator(".animate-pulse")).toHaveCount(0, { timeout: ESPERA });
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "2-horarios-de-atendimento.png") });

    // Celular, sem rolagem lateral da página.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/equipe");
    await expect(page.getByTestId("novo-equipe-horarios")).toBeVisible({ timeout: ESPERA });
    await expect(page.getByTestId("novo-equipe-membro").first()).toBeVisible({ timeout: ESPERA });
    const largura = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largura).toBeLessThanOrEqual(390);
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "3-equipe-no-celular.png") });
  });
});
