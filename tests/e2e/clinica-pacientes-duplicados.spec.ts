/**
 * JUNTAR PACIENTES DUPLICADOS NA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * A tela de contatos da versão atual tem o botão "Duplicados", que junta o mesmo paciente
 * cadastrado duas vezes (o mesmo celular com e sem o nono dígito, por exemplo). A interface nova
 * não tinha essa porta. Esta spec prova, pela tela, que agora tem: o administrador abre Pacientes,
 * vê os dois cadastros lado a lado, escolhe quem fica, confirma, e o banco registra que o outro foi
 * absorvido. A Recepção (`agent`) não vê o botão, porque quem junta é gerente para cima.
 *
 * O motor e a confirmação já são provados em `juntar-contatos-duplicados`; aqui o que se guarda é
 * a porta na interface nova.
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
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-pacientes-duplicados");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function idDoUsuario(email: string): Promise<string> {
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const achado = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (achado) return achado.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`usuário ${email} não encontrado`);
}

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

test.describe("Pacientes duplicados na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("o administrador junta os dois cadastros; a recepção não vê a porta", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
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
    const userId = await idDoUsuario(creds.users.admin!.email);
    const { data: vinculo } = await admin
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", userId)
      .limit(1)
      .single();
    const orgId = (vinculo as { organization_id: string }).organization_id;

    // O mesmo celular em duas grafias: com e sem o nono dígito. Strings diferentes para o banco,
    // a mesma pessoa para a detecção.
    const sufixo = String(Date.now()).slice(-7);
    const local = `9${sufixo}`;
    const fica = `Lia Dupla Fica ${sufixo}`;
    const absorvido = `Lia Dupla Antiga ${sufixo}`;
    const { data: contatos, error: erroContatos } = await admin
      .from("contacts")
      .insert([
        { organization_id: orgId, name: fica, phone_number: `+55319${local}` },
        { organization_id: orgId, name: absorvido, phone_number: `+5531${local}` },
      ] as never)
      .select("id, name");
    if (erroContatos || !contatos) throw new Error(`contacts insert: ${erroContatos?.message}`);
    const idDe = (nome: string) =>
      (contatos as { id: string; name: string }[]).find((c) => c.name === nome)!.id;
    const idFica = idDe(fica);
    const idAbsorvido = idDe(absorvido);

    try {
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
      await page.goto("/pacientes");
      const porta = page.getByTestId("novo-pacientes-duplicados");
      await expect(porta).toBeVisible({ timeout: ESPERA });
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-pacientes-com-duplicados.png") });

      await porta.click();
      const dialogo = page.getByRole("dialog");
      await expect(dialogo.getByText(absorvido, { exact: false })).toBeVisible({
        timeout: ESPERA,
      });
      const cartaoQueFica = dialogo.locator("label").filter({ hasText: fica });
      await cartaoQueFica.locator('input[type="radio"]').check();
      await expect(cartaoQueFica.getByText(/este fica/i)).toBeVisible();
      await cartaoQueFica.scrollIntoViewIfNeeded();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-dois-cadastros-lado-a-lado.png") });

      const grupo = dialogo
        .locator("div")
        .filter({ hasText: fica })
        .filter({ has: page.getByRole("button", { name: /^juntar$/i }) })
        .last();
      await grupo.getByRole("button", { name: /^juntar$/i }).click();
      const confirmacao = page.getByRole("alertdialog");
      await expect(confirmacao).toBeVisible({ timeout: ESPERA });
      await expect(confirmacao.getByText(fica, { exact: false })).toBeVisible();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "3-confirmacao.png") });
      await confirmacao.getByRole("button", { name: /juntar contatos/i }).click();
      await expect(confirmacao).toBeHidden({ timeout: ESPERA });

      // A prova é no banco: o antigo aponta para quem ficou.
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("contacts")
              .select("is_merged_into")
              .eq("id", idAbsorvido)
              .single();
            return (data as { is_merged_into: string | null } | null)?.is_merged_into ?? null;
          },
          { timeout: ESPERA },
        )
        .toBe(idFica);
      await expect(dialogo.getByText(absorvido, { exact: false })).toHaveCount(0, {
        timeout: ESPERA,
      });
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-depois-de-juntar.png") });
      await page.keyboard.press("Escape");

      // A busca só acha quem ficou.
      await page.getByLabel(/Buscar/).fill(sufixo);
      await expect(page.getByText(fica)).toBeVisible({ timeout: ESPERA });
      await expect(page.getByText(absorvido)).toHaveCount(0);

      // Celular: os dois botões cabem na largura.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/pacientes");
      await expect(page.getByTestId("novo-pacientes-duplicados")).toBeVisible({ timeout: ESPERA });
      await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "5-celular.png") });

      // A Recepção (`agent`) não vê a porta: juntar é de gerente para cima.
      const recepcao = creds.users.agent;
      if (recepcao) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await context.clearCookies();
        await page.goto("/login");
        await page.getByLabel(/e-?mail/i).fill(recepcao.email);
        await page.getByLabel(/senha/i).fill(creds.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await page.waitForURL(/\/(app|hoje)(\/|$|\?)/, { timeout: 20_000 });
        await page.goto("/pacientes");
        await expect(page.getByTestId("novo-pacientes")).toBeVisible({ timeout: ESPERA });
        await expect(page.getByTestId("novo-cadastrar-paciente")).toBeVisible();
        await expect(page.getByTestId("novo-pacientes-duplicados")).toHaveCount(0);
      }
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      await admin
        .from("contacts")
        .update({ is_merged_into: null } as never)
        .in("id", [idFica, idAbsorvido]);
      await admin.from("contacts").delete().in("id", [idAbsorvido, idFica]);
    }
  });
});
