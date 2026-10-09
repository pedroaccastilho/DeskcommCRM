/**
 * O ACABAMENTO DA INTERFACE NOVA (fork TOQ, módulo clínica), no claro e no escuro, no computador e
 * no celular.
 *
 * O Pedro viu o menu lateral do profissional torto: os rótulos de duas palavras ("Minha agenda",
 * "Meus pacientes") quebravam linha alinhados à esquerda, os de uma palavra ficavam centralizados,
 * e o item ativo crescia mais que os outros. Esta spec mede, por ferramenta e não a olho, o que
 * deixa o menu e as telas principais alinhados:
 *   - todo rótulo do menu lateral é centralizado, e todo item tem a mesma altura;
 *   - no celular, os rótulos das abas não se encostam nem se sobrepõem;
 *   - nenhuma tela principal passa da largura da janela;
 * e fotografa as telas nos quatro modos, para quem revisar ver o conjunto.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-acabamento-visual");

/** As telas de quem atende, que são as que o profissional abre o dia inteiro. */
const TELAS = ["/hoje", "/agenda", "/pacientes", "/tarefas", "/whatsapp"] as const;

/** As telas de quem administra, olhadas no escuro, que é onde o contraste falha primeiro. */
const TELAS_DA_GESTAO = ["/relatorios", "/equipe", "/ajustes", "/conta"] as const;

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

async function abrir(page: Page, tela: string): Promise<void> {
  await page.goto(tela);
  await expect(page.locator("main.n-palco")).toBeVisible({ timeout: ESPERA });
  await expect(page.locator("main.n-palco .animate-pulse")).toHaveCount(0, { timeout: ESPERA });
  await animacoesTerminadas(page);
}

/** Medidas do menu lateral: alinhamento do texto e altura de cada item. */
async function medidasDoTrilho(page: Page) {
  return page.locator("nav.n-trilho a.n-porta, nav.n-trilho button.n-porta").evaluateAll((els) =>
    els.map((el) => ({
      texto: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      alinhamento: getComputedStyle(el).textAlign,
      transborda: el.scrollWidth > el.clientWidth + 1,
    })),
  );
}

/** As caixas do texto de cada aba do celular, para ver se alguma encosta na vizinha. */
async function caixasDasAbas(page: Page) {
  return page.locator("nav.n-abas > *").evaluateAll((els) =>
    els.map((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const caixa = r.getBoundingClientRect();
      return {
        texto: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        esquerda: caixa.left,
        direita: caixa.right,
      };
    }),
  );
}

test.describe("Acabamento da interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("menu alinhado e telas dentro da janela, no claro e no escuro", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    const creds = lerCreds();

    await loginComoDono(page, creds);
    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-clinica");
    await expect(cartao).toBeVisible({ timeout: ESPERA });
    const instalar = page.getByTestId("instalar-clinica");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i)).toBeVisible({ timeout: ESPERA });

    await context.clearCookies();
    await loginComoAdmin(page, creds);

    try {
      for (const tema of ["light", "dark"] as const) {
        await page.goto("/hoje");
        await page.evaluate((t) => {
          window.localStorage.setItem("novo:ver-como", "saude");
          window.localStorage.setItem("deskcomm-theme", t);
        }, tema);

        // ── Computador ──
        await page.setViewportSize({ width: 1280, height: 800 });
        for (const tela of TELAS) {
          await abrir(page, tela);
          const largura = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(largura, `${tela} (${tema}) passa da janela`).toBeLessThanOrEqual(1280);
          await page.screenshot({
            path: path.join(EVIDENCIA, `${tema}-computador${tela.replace(/\//g, "-")}.png`),
          });
        }

        await abrir(page, "/agenda");
        const trilho = await medidasDoTrilho(page);
        expect(trilho.map((i) => i.texto)).toEqual(
          expect.arrayContaining(["Meu dia", "Minha agenda", "Meus pacientes"]),
        );
        for (const item of trilho) {
          expect(item.alinhamento, `"${item.texto}" centralizado`).toBe("center");
          expect(item.transborda, `"${item.texto}" cabe no item`).toBe(false);
        }
        // Os itens do menu principal têm a mesma altura, com uma ou duas palavras, ativo ou não.
        const alturas = await page
          .locator("nav.n-trilho > a.n-porta")
          .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
        expect(alturas.length).toBeGreaterThanOrEqual(3);
        expect(new Set(alturas).size, `alturas do menu: ${alturas.join(", ")}`).toBe(1);
        await page.locator("nav.n-trilho").screenshot({
          path: path.join(EVIDENCIA, `${tema}-menu-lateral.png`),
        });

        // ── Celular ──
        await page.setViewportSize({ width: 390, height: 844 });
        for (const tela of TELAS) {
          await abrir(page, tela);
          const largura = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(largura, `${tela} (${tema}, celular) passa da janela`).toBeLessThanOrEqual(390);
          await page.screenshot({
            path: path.join(EVIDENCIA, `${tema}-celular${tela.replace(/\//g, "-")}.png`),
          });
        }
        const abas = (await caixasDasAbas(page)).filter((a) => a.texto);
        for (let i = 1; i < abas.length; i++) {
          expect(
            abas[i]!.esquerda - abas[i - 1]!.direita,
            `"${abas[i - 1]!.texto}" e "${abas[i]!.texto}" separados`,
          ).toBeGreaterThanOrEqual(2);
        }
        await page.locator("nav.n-abas").screenshot({
          path: path.join(EVIDENCIA, `${tema}-abas-do-celular.png`),
        });
      }

      // ── Gestão e ficha do paciente, no escuro ──
      await page.goto("/hoje");
      await page.evaluate(() => {
        window.localStorage.setItem("novo:ver-como", "gestao");
        window.localStorage.setItem("deskcomm-theme", "dark");
      });
      for (const largura of [1280, 390]) {
        await page.setViewportSize({ width: largura, height: largura > 400 ? 800 : 844 });
        const onde = largura > 400 ? "computador" : "celular";
        for (const tela of TELAS_DA_GESTAO) {
          await abrir(page, tela);
          const rolagem = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(rolagem, `${tela} (escuro, ${onde}) passa da janela`).toBeLessThanOrEqual(largura);
          await page.screenshot({
            path: path.join(EVIDENCIA, `gestao-dark-${onde}${tela.replace(/\//g, "-")}.png`),
          });
        }
        await abrir(page, "/pacientes");
        await page.locator('a[href^="/pacientes/"]').first().click();
        await expect(page.getByTestId("novo-paciente")).toBeVisible({ timeout: ESPERA });
        await expect(page.locator("main.n-palco .animate-pulse")).toHaveCount(0, {
          timeout: ESPERA,
        });
        await animacoesTerminadas(page);
        const rolagem = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(rolagem, `ficha (escuro, ${onde}) passa da janela`).toBeLessThanOrEqual(largura);
        await page.screenshot({ path: path.join(EVIDENCIA, `gestao-dark-${onde}-ficha.png`) });
        if (largura < 400) {
          // A gestão tem seis abas no celular: nenhum rótulo encosta no vizinho.
          const abas = (await caixasDasAbas(page)).filter((a) => a.texto);
          expect(abas.length).toBeGreaterThanOrEqual(6);
          for (let i = 1; i < abas.length; i++) {
            expect(
              abas[i]!.esquerda - abas[i - 1]!.direita,
              `"${abas[i - 1]!.texto}" e "${abas[i]!.texto}" separados`,
            ).toBeGreaterThanOrEqual(2);
          }
          await page.locator("nav.n-abas").screenshot({
            path: path.join(EVIDENCIA, "gestao-dark-abas-do-celular.png"),
          });
        }
      }
    } finally {
      await page
        .evaluate(() => {
          window.localStorage.removeItem("novo:ver-como");
          window.localStorage.removeItem("deskcomm-theme");
        })
        .catch(() => {});
    }
  });
});
