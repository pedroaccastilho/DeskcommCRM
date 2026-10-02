/**
 * REGRAS DA CLÍNICA, SÓ DO ADMINISTRADOR (fork TOQ, módulo clínica, migration 9003).
 *
 * O administrador acha a tela em Configurações, muda a multa do cancelamento, etiqueta um tipo
 * de agendamento com a modalidade e dá preço a ele; tudo sobrevive ao recarregar, e o preço é o
 * "Preço padrão" do tipo no núcleo (um só). O gerente não vê a porta, cai fora se digitar o
 * endereço e recebe 403 ao ler ou mudar as regras; o perfil "Somente leitura" não lê as multas.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`. O que a spec grava
 * na organização (regras, etiqueta, preço, o tipo de agendamento) é desfeito no `finally`.
 */
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-regras-admin");

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

async function orgDoUsuario(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`user_organizations: ${error?.message ?? "sem org"}`);
  return (data as { organization_id: string }).organization_id;
}

/** Login por senha. `manager` e `viewer` do seed não têm MFA. */
async function entrar(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

test.describe("Regras da clínica: só o administrador", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("o administrador muda a multa, a modalidade e o preço; os outros perfis não chegam", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
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
    const orgId = await orgDoUsuario(await idDoUsuario(creds.users.admin!.email));

    const { data: tipo, error } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: "Sessão de fisioterapia E2E",
        slug: `sessao-fisio-e2e-${Date.now()}`,
      } as never)
      .select("id")
      .single();
    if (error || !tipo) throw new Error(`calendar_event_types insert: ${error?.message}`);
    const tipoId = (tipo as { id: string }).id;

    try {
      // A porta: Configurações › Regras da clínica.
      await page.goto("/app/settings");
      await page.getByRole("link", { name: /Regras da clínica/ }).click();
      await page.waitForURL(/\/app\/settings\/tenant\/clinica\/regras/, { timeout: ESPERA });
      await expect(page.getByRole("heading", { name: "Regras da clínica" })).toBeVisible();

      // Os padrões da TOQ chegam preenchidos.
      const multa = page.getByTestId("regra-multa_cancelamento_pct");
      await expect(multa).toHaveValue("30", { timeout: ESPERA });
      await expect(page.getByTestId("regra-pacote_validade_dias")).toHaveValue("60");
      await expect(page.getByTestId("bloco-pacotes")).toContainText("Guardado para depois");
      await page.screenshot({ path: path.join(EVIDENCIA, "regras-padrao.png"), fullPage: true });

      // Valor fora da faixa não salva e diz por quê.
      await multa.fill("150");
      await expect(page.getByText("Use um número inteiro de 0 a 100.")).toBeVisible();
      await expect(page.getByTestId("salvar-regras")).toBeDisabled();

      await multa.fill("40");
      await page.getByTestId("salvar-regras").click();
      await expect(page.getByText("Regras salvas.")).toBeVisible({ timeout: ESPERA });

      // Modalidade e preço do tipo, na mesma tela.
      const linha = page.getByTestId(`tipo-${tipoId}`);
      await expect(linha).toBeVisible({ timeout: ESPERA });
      await linha.getByTestId("tipo-modalidade").selectOption("fisioterapia");
      await linha.getByTestId("tipo-preco").fill("150,00");
      const gravouModalidade = page.waitForResponse(
        (r) => r.url().includes("/api/v1/clinica/tipos-atendimento") && r.request().method() === "PUT",
      );
      const gravouPreco = page.waitForResponse(
        (r) => r.url().includes("/api/v1/agenda/tipos") && r.request().method() === "PATCH",
      );
      await linha.getByTestId("salvar-tipo").click();
      expect((await gravouModalidade).status()).toBe(200);
      expect((await gravouPreco).status()).toBe(200);
      await expect(linha.getByTestId("salvar-tipo")).toBeDisabled({ timeout: ESPERA });

      await page.reload();
      await expect(page.getByTestId("regra-multa_cancelamento_pct")).toHaveValue("40", {
        timeout: ESPERA,
      });
      const linhaDepois = page.getByTestId(`tipo-${tipoId}`);
      await expect(linhaDepois.getByTestId("tipo-modalidade")).toHaveValue("fisioterapia");
      await expect(linhaDepois.getByTestId("tipo-preco")).toHaveValue("150,00");
      await linhaDepois.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "regras-salvas.png") });

      const { data: preco } = await admin
        .from("calendar_event_types")
        .select("default_price_cents")
        .eq("id", tipoId)
        .single();
      expect(Number((preco as { default_price_cents: number }).default_price_cents)).toBe(15000);

      // O gerente não vê a porta, não abre a tela e não lê nem muda as regras.
      await context.clearCookies();
      await entrar(page, creds.users.manager!.email, creds.password);
      await page.goto("/app/settings");
      await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(page.getByRole("link", { name: /Regras da clínica/ })).toHaveCount(0);
      await page.goto("/app/settings/tenant/clinica/regras");
      await page.waitForURL(/\/app\/settings$/, { timeout: ESPERA });
      expect((await page.request.get("/api/v1/clinica/politicas")).status()).toBe(403);
      expect(
        (
          await page.request.put("/api/v1/clinica/tipos-atendimento", {
            data: { event_type_id: tipoId, modalidade: null },
          })
        ).status(),
      ).toBe(403);
      // A modalidade continua de todos: a agenda pinta por ela.
      expect((await page.request.get("/api/v1/clinica/tipos-atendimento")).status()).toBe(200);
      await page.screenshot({ path: path.join(EVIDENCIA, "gerente-sem-a-porta.png") });

      // "Somente leitura" não lê valor financeiro.
      await context.clearCookies();
      await entrar(page, creds.users.viewer!.email, creds.password);
      expect((await page.request.get("/api/v1/clinica/multas")).status()).toBe(403);
    } finally {
      await admin.from("clinica_politicas").delete().eq("organization_id", orgId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
