/**
 * O CALENDÁRIO DE TAREFAS NA INTERFACE NOVA (fork TOQ).
 *
 * A tela de Tarefas da versão atual tem Lista e Calendário; a nova só tinha a lista. Esta spec
 * prova, pela tela, que a nova tem o Calendário: a tarefa aparece no dia do prazo, abre a folha
 * dela, e tocar num dia abre uma tarefa nova já com aquele prazo, que vai parar naquele dia.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-tarefas-calendario");

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

test.describe("Calendário de tarefas na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a tarefa aparece no dia do prazo e o dia abre uma tarefa nova", async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    if (!destinoEhLocal(URL_SUPABASE)) {
      throw new Error(`RECUSADO: ${URL_SUPABASE} não é loopback.`);
    }
    await loginComoAdmin(page, lerCreds());

    const sufixo = String(Date.now()).slice(-7);
    const primeira = `Ligar para o convênio ${sufixo}`;
    const segunda = `Pedir o exame ${sufixo}`;
    // O prazo é hoje às 15h no relógio do navegador (o calendário mostra o dia local).
    const prazo = await page.evaluate(() => {
      const d = new Date();
      d.setHours(15, 0, 0, 0);
      return d.toISOString();
    });
    const criada = await page.request.post("/api/v1/tasks", {
      data: { title: primeira, due_date: prazo, priority: "medium", lead_id: null },
    });
    expect(criada.status(), await criada.text()).toBeLessThan(300);

    try {
      await page.goto("/tarefas");
      await page.getByTestId("novo-tarefas-calendario").click();
      const mes = page.getByTestId("novo-tarefas-mes");
      await expect(mes).toBeVisible({ timeout: ESPERA });
      const diaDeHoje = mes.getByTestId("novo-tarefas-dia").filter({ hasText: primeira });
      await expect(diaDeHoje).toHaveCount(1, { timeout: ESPERA });
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-calendario.png") });

      // A tarefa abre a folha dela.
      await diaDeHoje.getByTestId("novo-tarefas-no-dia").filter({ hasText: primeira }).click();
      const folha = page.getByTestId("novo-folha-tarefa");
      await expect(folha.getByTestId("novo-tarefa-titulo")).toHaveValue(primeira, {
        timeout: ESPERA,
      });
      await folha.getByRole("button", { name: "Fechar" }).click();
      await expect(folha).toHaveCount(0, { timeout: ESPERA });

      // O dia 28 (existe em todo mês) abre uma tarefa nova com esse prazo.
      const dia28 = mes.getByTestId("novo-tarefas-dia").nth(27);
      await dia28.locator("button").first().click();
      await expect(folha).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-tarefa-dia")).toHaveValue(/-28$/);
      await folha.getByTestId("novo-tarefa-titulo").fill(segunda);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-nova-no-dia.png") });
      await folha.getByTestId("novo-salvar-tarefa").click();
      await expect(folha).toHaveCount(0, { timeout: ESPERA });
      await expect(dia28).toContainText(segunda, { timeout: ESPERA });
      await dia28.scrollIntoViewIfNeeded();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "3-tarefa-no-dia-28.png") });

      // Celular: o mês cabe na largura, com a contagem em cada dia.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(mes).toBeVisible();
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-celular.png") });
    } finally {
      await admin.from("crm_tasks").delete().in("title", [primeira, segunda]);
    }
  });
});
