/**
 * OS LEADS NA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * O Pedro viu que os funis de venda (os leads) ficaram de fora do layout novo: só o Administrador
 * os achava, escondidos nos Ajustes, e a Recepção não tinha porta nenhuma. Esta spec prova, pela
 * tela, que agora "Leads" está no menu de Recepção e Gestão:
 *   - a Gestão abre Leads pelo menu lateral, cria um funil e abre o quadro dele sem sair daqui;
 *   - o endereço antigo dos Ajustes leva ao novo;
 *   - no celular da Gestão (seis portas), Leads fica no menu de "Você"; no da Recepção, nas abas;
 *   - a Recepção de verdade (`agent`) vê a porta e abre o funil.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA = process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-leads");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

test.describe("Leads na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("Recepção e Gestão abrem os funis pelo menu, sem sair da interface nova", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    const creds = lerCreds();
    if (!destinoEhLocal(URL_SUPABASE)) {
      throw new Error(`RECUSADO: ${URL_SUPABASE} não é loopback.`);
    }

    await loginComoDono(page, creds);
    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-clinica");
    await expect(cartao).toBeVisible({ timeout: ESPERA });
    const instalar = page.getByTestId("instalar-clinica");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i)).toBeVisible({ timeout: ESPERA });

    await context.clearCookies();
    await loginComoAdmin(page, creds);
    const nome = `Funil E2E ${String(Date.now()).slice(-7)}`;

    try {
      // ── Gestão, no computador: a porta no menu lateral ──
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
      await page.goto("/hoje");
      const trilho = page.locator("nav.n-trilho");
      await trilho.getByRole("link", { name: "Leads" }).click();
      await expect(page).toHaveURL(/\/funis$/, { timeout: ESPERA });
      await expect(trilho.getByRole("link", { name: "Leads" })).toHaveAttribute(
        "aria-current",
        "page",
      );

      // Cria um funil e abre o quadro dele: o link de lá fica aqui.
      await page.getByTestId("novo-funil").click();
      await page.getByTestId("nome-do-novo-funil").fill(nome);
      await page.getByTestId("confirmar-novo-funil").click();
      const linha = page.getByRole("link", { name: nome });
      await expect(linha).toBeVisible({ timeout: ESPERA });
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-gestao-leads.png") });

      await linha.click();
      await expect(page).toHaveURL(/\/funis\/[0-9a-f-]{36}/, { timeout: ESPERA });
      await expect(page.locator("main.n-palco")).toContainText(nome, { timeout: ESPERA });
      await expect(page.getByRole("link", { name: /Leads/ }).first()).toBeVisible();
      await expect(page.locator("main.n-palco").getByText("Carregando…")).toHaveCount(0, {
        timeout: ESPERA,
      });
      const quadro = page.url();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-gestao-quadro-do-funil.png") });

      // O endereço antigo dos Ajustes leva ao novo, com o mesmo funil.
      const id = quadro.match(/\/funis\/([0-9a-f-]{36})/)![1]!;
      await page.goto(`/ajustes/funis/${id}`);
      await expect(page).toHaveURL(new RegExp(`/funis/${id}$`), { timeout: ESPERA });
      await page.goto("/ajustes/funis");
      await expect(page).toHaveURL(/\/funis$/, { timeout: ESPERA });

      // ── Gestão, no celular: seis portas não cabem, Leads fica no menu de "Você" ──
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/hoje");
      const abas = page.locator("nav.n-abas");
      await expect(abas.getByRole("link", { name: "Relatórios" })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(abas.getByRole("link", { name: "Leads" })).toHaveCount(0);
      await abas.getByTestId("novo-menu-da-pessoa").click();
      const portaNoMenu = abas.getByTestId("novo-menu-leads");
      await expect(portaNoMenu).toBeVisible();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "3-gestao-celular-menu-voce.png") });
      await portaNoMenu.click();
      await expect(page).toHaveURL(/\/funis$/, { timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura, "Leads no celular passa da janela").toBeLessThanOrEqual(390);

      // ── A Recepção de verdade (`agent`) ──
      const recepcao = creds.users.agent;
      if (recepcao) {
        await page.evaluate(() => window.localStorage.removeItem("novo:ver-como"));
        await page.setViewportSize({ width: 1280, height: 800 });
        await context.clearCookies();
        await page.goto("/login");
        await page.getByLabel(/e-?mail/i).fill(recepcao.email);
        await page.getByLabel(/senha/i).fill(creds.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await page.waitForURL(/\/(app|hoje)(\/|$|\?)/, { timeout: 20_000 });
        await page.goto("/hoje");
        await page.locator("nav.n-trilho").getByRole("link", { name: "Leads" }).click();
        await expect(page).toHaveURL(/\/funis$/, { timeout: ESPERA });
        const funil = page.getByRole("link", { name: nome });
        await expect(funil).toBeVisible({ timeout: ESPERA });
        await animacoesTerminadas(page);
        await page.screenshot({ path: path.join(EVIDENCIA, "4-recepcao-leads.png") });
        await funil.click();
        await expect(page).toHaveURL(/\/funis\/[0-9a-f-]{36}/, { timeout: ESPERA });
        await expect(page.locator("main.n-palco")).toContainText(nome, { timeout: ESPERA });

        // No celular da Recepção (cinco portas), Leads cabe nas abas.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/hoje");
        const abasDaRecepcao = page.locator("nav.n-abas");
        await expect(abasDaRecepcao.getByRole("link", { name: "Leads" })).toBeVisible({
          timeout: ESPERA,
        });
        await expect(page.locator("main.n-palco .animate-pulse")).toHaveCount(0, {
          timeout: ESPERA,
        });
        await animacoesTerminadas(page);
        await page.screenshot({ path: path.join(EVIDENCIA, "5-recepcao-celular-abas.png") });
      }
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      await admin.from("crm_pipelines").delete().eq("name", nome);
    }
  });
});
