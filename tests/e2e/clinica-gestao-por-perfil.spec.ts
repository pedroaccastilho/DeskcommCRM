/**
 * A GESTÃO DE QUEM NÃO ADMINISTRA NA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * Com a chave "A equipe usa só a interface nova", Gerente, Financeiro e Jurídico perdiam as telas
 * que tinham no menu da versão atual: só o Administrador chegava a Comandas, Faturamento, Auditoria
 * e LGPD, pelos Ajustes. Esta spec prova, pela tela, a porta "Gestão" de cada perfil:
 *   - o Financeiro abre Comandas, Faturamento e Financeiro, e nada de auditoria nem LGPD;
 *   - o Jurídico abre Auditoria e LGPD, vê "quem abriu" na ficha e nenhum conteúdo clínico, e não
 *     vê dinheiro;
 *   - o Gerente não abre a LGPD pelo servidor.
 * O usuário é o `manager` do seed, com os perfis gravados em `clinica_cargos_membro` e devolvidos
 * no fim.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-gestao-por-perfil");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Creds = ReturnType<typeof lerCreds>;

/** O `manager` do seed não tem TOTP: entra direto. */
async function entrarComoGerente(page: Page, creds: Creds): Promise<void> {
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(app|hoje)(\/|$|\?)/, { timeout: 20_000 });
}

async function rotulosDaGestao(page: Page): Promise<string[]> {
  await page.goto("/ajustes");
  await expect(page.getByRole("heading", { level: 1, name: "Gestão" })).toBeVisible({
    timeout: ESPERA,
  });
  const itens = page.getByTestId("novo-ajuste-item");
  await expect(itens.first()).toBeVisible({ timeout: ESPERA });
  return (await itens.locator("span.font-semibold").allInnerTexts()).map((s) => s.trim()).sort();
}

test.describe("A porta Gestão por perfil na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("Financeiro cobra, Jurídico vê LGPD e quem abriu, ninguém além do perfil", async ({
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

    const userId = creds.users.manager!.id;
    const { data: vinculo } = await admin
      .from("user_organizations")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .single();
    const orgId = (vinculo as { organization_id: string; role: string }).organization_id;
    expect((vinculo as { role: string }).role).toBe("manager");
    const { data: antes } = await admin
      .from("clinica_cargos_membro")
      .select("organization_id, user_id, cargo")
      .eq("organization_id", orgId)
      .eq("user_id", userId);
    const gravarPerfis = async (cargos: string[]) => {
      await admin
        .from("clinica_cargos_membro")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId);
      const { error } = await admin
        .from("clinica_cargos_membro")
        .insert(
          cargos.map((cargo) => ({ organization_id: orgId, user_id: userId, cargo })) as never,
        );
      if (error) throw new Error(`clinica_cargos_membro insert: ${error.message}`);
    };

    const sufixo = String(Date.now()).slice(-7);
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: `Vera Gestao ${sufixo}`,
        phone_number: `+5511966${sufixo}`,
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    try {
      // ── Financeiro ──
      await gravarPerfis(["financeiro"]);
      await entrarComoGerente(page, creds);
      await page.goto("/hoje");
      const porta = page.getByTestId("novo-porta-gestao");
      await expect(porta).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("novo-porta-ajustes")).toHaveCount(0);
      expect(await rotulosDaGestao(page)).toEqual(["Comandas", "Faturamento", "Financeiro"]);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-gestao-do-financeiro.png") });

      await page.getByTestId("novo-ajuste-item").filter({ hasText: "Comandas" }).click();
      await page.waitForURL(/\/ajustes\/comandas/, { timeout: ESPERA });
      await expect(page.getByTestId("novo-ajuste")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByRole("link", { name: "‹ Gestão" })).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "2-comandas-pela-gestao.png") });
      expect((await page.request.get("/api/v1/lgpd/requests")).status()).toBe(403);

      // ── Jurídico ──
      await gravarPerfis(["juridico"]);
      await page.goto("/hoje");
      await expect(page.getByTestId("novo-porta-gestao")).toBeVisible({ timeout: ESPERA });
      expect(await rotulosDaGestao(page)).toEqual(["Audit Log", "LGPD"]);
      await page.screenshot({ path: path.join(EVIDENCIA, "3-gestao-do-juridico.png") });

      const listaDaLgpd = page.waitForResponse(
        (r) => r.url().includes("/api/v1/lgpd/requests") && r.request().method() === "GET",
      );
      await page.getByTestId("novo-ajuste-item").filter({ hasText: "LGPD" }).click();
      await page.waitForURL(/\/ajustes\/lgpd/, { timeout: ESPERA });
      await expect(page.getByRole("heading", { name: "Solicitações LGPD" })).toBeVisible({
        timeout: ESPERA,
      });
      expect((await listaDaLgpd).status()).toBe(200);
      await expect(page.getByTestId("novo-ajuste").locator(".animate-pulse")).toHaveCount(0, {
        timeout: ESPERA,
      });
      await page.screenshot({ path: path.join(EVIDENCIA, "4-lgpd-do-juridico.png") });
      expect((await page.request.get("/api/v1/lgpd/requests")).status()).toBe(200);
      // Sem dinheiro: o relatório da gestão continua fechado para o Jurídico.
      expect((await page.request.get("/api/v1/clinica/relatorios/gestao")).status()).toBe(403);

      // Na ficha, quem abriu e quando, sem o conteúdo clínico.
      await page.goto(`/pacientes/${contactId}`);
      await expect(page.getByTestId("novo-acessos")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("novo-prontuario")).toHaveCount(0);
      await expect(
        page.getByText("O prontuário é visto só pelos profissionais de saúde da clínica."),
      ).toBeVisible();
      expect(
        (await page.request.get(`/api/v1/clinica/acessos?contact_id=${contactId}`)).status(),
      ).toBe(200);
      // Nem pelo servidor: num paciente que TEM prontuário assinado, a leitura volta vazia.
      const { data: comRegistro } = await admin
        .from("prontuario_registros")
        .select("contact_id")
        .eq("organization_id", orgId)
        .limit(1)
        .maybeSingle();
      if (comRegistro) {
        const lido = await page.request.get(
          `/api/v1/clinica/prontuario?contact_id=${(comRegistro as { contact_id: string }).contact_id}`,
        );
        if (lido.ok()) expect(((await lido.json()) as { data: unknown[] }).data).toEqual([]);
        else expect(lido.status()).toBeGreaterThanOrEqual(400);
      }
      await page.getByTestId("novo-acessos").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "5-ficha-do-juridico.png") });

      // ── Gerente ──: a gestão inteira, menos a LGPD.
      await gravarPerfis(["gerente"]);
      await page.goto("/hoje");
      expect(await rotulosDaGestao(page)).toEqual(
        ["Atividades", "Audit Log", "Comandas", "Desempenho", "Faturamento", "Financeiro"].sort(),
      );
      expect((await page.request.get("/api/v1/lgpd/requests")).status()).toBe(403);
      expect(
        (await page.request.get(`/api/v1/clinica/acessos?contact_id=${contactId}`)).status(),
      ).toBe(403);

      // Celular: a porta mora no menu da pessoa.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/hoje");
      await page.getByTestId("novo-menu-da-pessoa").filter({ visible: true }).click();
      await expect(page.getByTestId("novo-menu-gestao")).toBeVisible({ timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "6-celular.png") });
    } finally {
      await admin
        .from("clinica_cargos_membro")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId);
      if ((antes ?? []).length > 0) {
        await admin.from("clinica_cargos_membro").insert(antes as never);
      }
      await admin.from("contacts").delete().eq("id", contactId);
    }
  });
});
