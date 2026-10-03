/**
 * PACOTES DE SESSÕES NA FICHA DO PACIENTE (fork TOQ, módulo clínica).
 *
 * Pela tela, como a recepção e a gerência fariam: vender um pacote do catálogo só depois do
 * aceite da política de cancelamento, ver o saldo e o aviso de renovação, congelar, prorrogar e
 * cancelar. A recepção (Atendente) vende e congela, mas não vê prorrogar nem cancelar; "Somente
 * leitura" não vê o cartão, porque o valor é financeiro.
 *
 * As sessões gastas entram direto em `clinica_pacote_consumos`: quem as lança no uso real é a
 * agenda do núcleo (Compareceu/Faltou), e isso já é provado pelos invariantes do backend.
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
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-pacotes-na-ficha");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function foto(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`) });
}

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

test.describe("Ficha do paciente: pacotes de sessões", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("vende com o aceite da política, mostra o saldo e ajusta conforme o perfil", async ({
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

    const orgId = await orgDoUsuario(await idDoUsuario(creds.users.admin!.email));
    const sufixo = Date.now().toString(36);
    const nomeDoProduto = `Pilates 8 aulas ${sufixo}`;
    const { data: produto, error: erroProduto } = await admin
      .from("clinica_produtos")
      .insert({
        organization_id: orgId,
        nome: nomeDoProduto,
        modalidade: "pilates",
        sessoes: 8,
        validade_dias: 45,
        valor_cents: 48000,
      } as never)
      .select("id")
      .single();
    if (erroProduto || !produto)
      throw new Error(`clinica_produtos insert: ${erroProduto?.message}`);
    const produtoId = (produto as { id: string }).id;

    const nomeDoPaciente = `Paciente do pacote ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nomeDoPaciente, source: "manual" } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const pacienteId = (contato as { id: string }).id;

    try {
      // 1. Gerência: ficha sem pacote, venda bloqueada até o aceite.
      await context.clearCookies();
      await loginComoAdmin(page, creds);
      await page.goto(`/app/contacts/${pacienteId}`);
      const secao = page.getByTestId("pacotes-do-paciente");
      await expect(secao).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("sem-pacote-valendo")).toContainText("Nenhum pacote vendido");

      await secao.getByRole("button", { name: "Vender pacote" }).click();
      const dialogo = page.getByRole("dialog");
      await expect(dialogo.getByText(nomeDoProduto)).toBeVisible({ timeout: ESPERA });
      await expect(dialogo.getByText("Pacote padrão de Fisioterapia")).toBeVisible();
      await dialogo.getByText(nomeDoProduto).click();
      const politica = dialogo.getByTestId("politica-do-pacote");
      await expect(politica).toContainText("24 horas");
      await expect(politica).toContainText("30%");
      const confirmar = dialogo.getByRole("button", { name: "Confirmar venda" });
      await expect(confirmar).toBeDisabled();
      await dialogo.getByTestId("aceite-da-politica").check();
      await expect(confirmar).toBeEnabled();
      await foto(page, "e2e-venda");
      await confirmar.click();
      await expect(dialogo).toBeHidden({ timeout: ESPERA });

      const valendo = page.getByTestId("pacote-valendo");
      await expect(valendo.getByTestId("saldo-do-pacote")).toHaveText("Restam 8 de 8 sessões", {
        timeout: ESPERA,
      });
      await expect(valendo).toContainText("R$");
      await expect(valendo.getByTestId("hora-de-renovar")).toHaveCount(0);

      // 2. Seis sessões gastas: restam 2, e é hora de oferecer a renovação.
      const { data: vendido } = await admin
        .from("clinica_pacotes")
        .select("id, aceite_multa_pct, aceite_antecedencia_horas")
        .eq("contact_id", pacienteId)
        .single();
      const pacote = vendido as {
        id: string;
        aceite_multa_pct: number;
        aceite_antecedencia_horas: number;
      };
      expect(Number(pacote.aceite_multa_pct)).toBe(30);
      expect(pacote.aceite_antecedencia_horas).toBe(24);
      const { error: erroConsumo } = await admin.from("clinica_pacote_consumos").insert(
        Array.from({ length: 6 }, (_, i) => ({
          organization_id: orgId,
          pacote_id: pacote.id,
          motivo: "realizada",
          sessao_em: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
        })) as never,
      );
      if (erroConsumo) throw new Error(`clinica_pacote_consumos insert: ${erroConsumo.message}`);
      await page.reload();
      await expect(valendo.getByTestId("saldo-do-pacote")).toHaveText("Restam 2 de 8 sessões", {
        timeout: ESPERA,
      });
      await expect(valendo.getByTestId("hora-de-renovar")).toBeVisible();
      await secao.scrollIntoViewIfNeeded();
      await foto(page, "e2e-saldo");

      // 3. Congelar uma vez; depois o botão some.
      await valendo.getByRole("button", { name: "Congelar" }).click();
      await dialogo.getByLabel("Congelar por quantos dias").fill("10");
      await dialogo.getByLabel("Motivo").fill("Viagem de férias");
      await dialogo.getByRole("button", { name: "Congelar" }).click();
      await expect(valendo.getByTestId("pacote-congelado")).toContainText("Congelado até", {
        timeout: ESPERA,
      });
      await expect(valendo.getByRole("button", { name: "Congelar" })).toHaveCount(0);

      // 4. Prorrogar e cancelar são da gerência.
      await valendo.getByRole("button", { name: "Prorrogar" }).click();
      await dialogo.getByLabel("Prorrogar por quantos dias").fill("15");
      await dialogo.getByLabel("Motivo").fill("Paciente operou o joelho");
      await dialogo.getByRole("button", { name: "Prorrogar" }).click();
      await expect(dialogo).toBeHidden({ timeout: ESPERA });

      await valendo.getByRole("button", { name: "Cancelar pacote" }).click();
      await dialogo.getByLabel("Motivo").fill("Mudou de cidade");
      await foto(page, "e2e-cancelar");
      await dialogo.getByRole("button", { name: "Cancelar pacote" }).click();
      await expect(page.getByTestId("sem-pacote-valendo")).toContainText("Nenhum pacote valendo", {
        timeout: ESPERA,
      });
      const anteriores = page.getByTestId("pacotes-anteriores");
      await anteriores.getByText("1 pacote anterior").click();
      await expect(anteriores).toContainText("Cancelado em");

      // 5. Recepção: vende o pacote padrão, só congela.
      await context.clearCookies();
      await login(page, creds.users.agent!.email, creds.password);
      await page.goto(`/app/contacts/${pacienteId}`);
      await expect(secao).toBeVisible({ timeout: ESPERA });
      await secao.getByRole("button", { name: "Vender pacote" }).click();
      await dialogo.getByText("Pacote padrão de Fisioterapia").click();
      await dialogo.getByLabel("Valor do pacote (opcional)").fill("450,00");
      await dialogo.getByTestId("aceite-da-politica").check();
      await dialogo.getByRole("button", { name: "Confirmar venda" }).click();
      await expect(valendo.getByTestId("saldo-do-pacote")).toHaveText("Restam 10 de 10 sessões", {
        timeout: ESPERA,
      });
      await expect(valendo.getByRole("button", { name: "Congelar" })).toBeVisible();
      await expect(valendo.getByRole("button", { name: "Prorrogar" })).toHaveCount(0);
      await expect(valendo.getByRole("button", { name: "Cancelar pacote" })).toHaveCount(0);
      await secao.scrollIntoViewIfNeeded();
      await foto(page, "e2e-recepcao");

      // 6. Somente leitura: a ficha abre, o cartão dos pacotes não.
      await context.clearCookies();
      await login(page, creds.users.viewer!.email, creds.password);
      await page.goto(`/app/contacts/${pacienteId}`);
      await expect(page.getByRole("heading", { name: nomeDoPaciente })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(secao).toHaveCount(0);
    } finally {
      await admin.from("clinica_pacotes").delete().eq("contact_id", pacienteId);
      await admin.from("contacts").delete().eq("id", pacienteId);
      await admin.from("clinica_produtos").delete().eq("id", produtoId);
    }
  });
});
