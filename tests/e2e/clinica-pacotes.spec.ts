/**
 * PACOTES DE SESSÕES (fork TOQ, módulo clínica, migration 9004).
 *
 * O administrador cadastra um pacote no catálogo em Configurações › Regras da clínica (o valor é
 * opcional) e vê o bloco "Pacotes" em uso. A recepção vende o pacote com o aceite da política (o
 * clique duplo não vende dois), e a AGENDA passa a mexer no saldo: "Compareceu" gasta uma
 * sessão, e o cancelamento em cima da hora cobra a multa sobre o valor da sessão NO PACOTE
 * (total / sessões), não sobre o preço avulso do tipo. Congelar vale uma vez. "Somente leitura"
 * não vê pacote.
 *
 * A venda ainda não tem tela (é da frente de interface): a spec vende pela mesma rota que a tela
 * vai chamar, com a sessão do navegador. O que tem tela (catálogo, "Compareceu", cancelamento e a
 * multa) é dirigido pela tela.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const MINUTO = 60 * 1000;
const EVIDENCIA = process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-pacotes");

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

/** Login por senha. O `viewer` do seed não tem MFA. */
async function entrar(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

type Pacote = {
  id: string;
  saldo: number;
  sessoes_usadas: number;
  valido_ate: string;
  valor_cents: number | null;
  situacao: string;
  aceite_multa_pct: number;
};

test.describe("Pacotes de sessões", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("catálogo pela tela, venda com aceite, a agenda gasta o saldo e a multa usa o valor do pacote", async ({
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
    const userId = await idDoUsuario(creds.users.admin!.email);
    const orgId = await orgDoUsuario(userId);
    const sufixo = Date.now().toString(36);
    const nomeDoProduto = `Fisioterapia 10 sessões ${sufixo}`;

    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Sessão de fisioterapia ${sufixo}`,
        slug: `sessao-fisio-pacote-${sufixo}`,
        duration_minutes: 50,
        default_price_cents: 15000,
      } as never)
      .select("id")
      .single();
    if (erroTipo || !tipo) throw new Error(`calendar_event_types insert: ${erroTipo?.message}`);
    const tipoId = (tipo as { id: string }).id;
    const { error: erroEtiqueta } = await admin.from("clinica_tipos_atendimento").insert({
      organization_id: orgId,
      event_type_id: tipoId,
      modalidade: "fisioterapia",
    } as never);
    if (erroEtiqueta) throw new Error(`clinica_tipos_atendimento insert: ${erroEtiqueta.message}`);

    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: `Paciente do pacote ${sufixo}`,
        source: "manual",
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const pacienteId = (contato as { id: string }).id;

    async function semear(comeca: Date): Promise<string> {
      const { data, error } = await admin
        .from("calendar_appointments")
        .insert({
          organization_id: orgId,
          title: "Fisioterapia",
          starts_at: comeca.toISOString(),
          ends_at: new Date(comeca.getTime() + 50 * MINUTO).toISOString(),
          status: "confirmed",
          owner_user_id: userId,
          contact_id: pacienteId,
          event_type_id: tipoId,
          created_by_kind: "system",
          source: "ui",
        } as never)
        .select("id")
        .single();
      if (error || !data) throw new Error(`calendar_appointments insert: ${error?.message}`);
      return (data as { id: string }).id;
    }
    const jaAconteceu = await semear(new Date(Date.now() - 2 * 60 * MINUTO));
    const emCimaDaHora = await semear(new Date(Date.now() + 3 * 60 * MINUTO));

    async function pacotesDoPaciente(): Promise<Pacote[]> {
      const r = await page.request.get(`/api/v1/clinica/pacotes?contact_id=${pacienteId}`);
      expect(r.status()).toBe(200);
      return ((await r.json()) as { data: Pacote[] }).data;
    }

    try {
      // 1. O catálogo, pela tela das Regras.
      await page.goto("/app/settings/tenant/clinica/regras");
      await expect(page.getByTestId("bloco-pacotes")).toContainText("Em uso", { timeout: ESPERA });
      await expect(page.getByTestId("bloco-reposicoes")).toContainText("Guardado para depois");
      const novo = page.getByTestId("produto-novo");
      await novo.getByTestId("produto-nome").fill(nomeDoProduto);
      await novo.getByTestId("produto-modalidade").selectOption("fisioterapia");
      await novo.getByTestId("produto-valor").fill("1200,00");
      const cadastrou = page.waitForResponse(
        (r) => r.url().includes("/api/v1/clinica/produtos") && r.request().method() === "POST",
      );
      await novo.getByTestId("salvar-produto").click();
      expect((await cadastrou).status()).toBe(201);

      await page.reload();
      const catalogo = page.getByTestId("bloco-catalogo");
      await expect(catalogo.locator(`input[value="${nomeDoProduto}"]`)).toBeVisible({
        timeout: ESPERA,
      });
      await catalogo.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "catalogo.png"), fullPage: true });

      const produtos = (await (await page.request.get("/api/v1/clinica/produtos")).json()) as {
        data: Array<{
          id: string;
          nome: string;
          sessoes: number;
          validade_dias: number;
          valor_cents: number;
        }>;
      };
      const produto = produtos.data.find((p) => p.nome === nomeDoProduto)!;
      expect(produto).toMatchObject({ sessoes: 10, validade_dias: 60, valor_cents: 120000 });

      // 2. A venda: sem o aceite da política, não vende; com a mesma chave, vende uma vez.
      const semAceite = await page.request.post("/api/v1/clinica/pacotes", {
        data: { contact_id: pacienteId, produto_id: produto.id },
      });
      expect(semAceite.status()).toBe(422);

      const chave = randomUUID();
      const vender = () =>
        page.request.post("/api/v1/clinica/pacotes", {
          data: { contact_id: pacienteId, produto_id: produto.id, aceite_politica: true },
          headers: { "Idempotency-Key": chave },
        });
      const venda = await vender();
      expect(venda.status()).toBe(201);
      const vendido = ((await venda.json()) as { data: Pacote }).data;
      expect(vendido).toMatchObject({
        saldo: 10,
        situacao: "ativo",
        valor_cents: 120000,
        aceite_multa_pct: 30,
      });
      const dias = (new Date(vendido.valido_ate).getTime() - Date.now()) / (24 * 60 * MINUTO);
      expect(dias).toBeGreaterThan(59.9);
      expect(dias).toBeLessThan(60.1);
      const replay = ((await (await vender()).json()) as { data: Pacote }).data;
      expect(replay.id).toBe(vendido.id);
      expect(await pacotesDoPaciente()).toHaveLength(1);

      // 3. "Compareceu" na agenda gasta uma sessão do pacote.
      await page.goto(`/app/agenda?compromisso=${jaAconteceu}`);
      const compareceu = page.getByRole("button", { name: "Compareceu" });
      await expect(compareceu).toBeEnabled({ timeout: ESPERA });
      const registrou = page.waitForResponse(
        (r) => r.url().includes("/api/v1/agenda/agendamentos") && r.request().method() === "PATCH",
      );
      await compareceu.click();
      expect((await registrou).status()).toBe(200);
      await expect
        .poll(async () => (await pacotesDoPaciente())[0]?.saldo, { timeout: ESPERA })
        .toBe(9);

      // 4. Cancelar em cima da hora: a multa é 30% da sessão NO PACOTE (R$ 1.200 / 10 = R$ 120),
      //    não do preço avulso do tipo (R$ 150). E cancelar não gasta sessão.
      await page.goto(`/app/agenda?compromisso=${emCimaDaHora}`);
      await expect(page.getByTestId("aviso-de-multa")).toBeVisible({ timeout: ESPERA });
      await page.getByLabel("Motivo do cancelamento").fill("Paciente avisou que não vem");
      await page.getByRole("button", { name: "Cancelar agendamento" }).click();
      await expect(page.getByTestId("valor-da-multa")).toContainText("36,00", { timeout: ESPERA });
      await page.getByTestId("multa-da-sessao").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "multa-pelo-pacote.png") });
      expect((await pacotesDoPaciente())[0]?.saldo).toBe(9);

      // 5. Congelar anda a validade, uma vez só.
      const congelar = (d: number) =>
        page.request.post(`/api/v1/clinica/pacotes/${vendido.id}/congelar`, {
          data: { dias: d, motivo: "Viagem a trabalho" },
        });
      const congelado = await congelar(10);
      expect(congelado.status()).toBe(200);
      const depois = ((await congelado.json()) as { data: Pacote }).data;
      expect(new Date(depois.valido_ate).getTime() - new Date(vendido.valido_ate).getTime()).toBe(
        10 * 24 * 60 * MINUTO,
      );
      expect((await congelar(5)).status()).toBe(409);

      // 6. "Somente leitura" não vê pacote nem catálogo.
      await context.clearCookies();
      await entrar(page, creds.users.viewer!.email, creds.password);
      expect(
        (await page.request.get(`/api/v1/clinica/pacotes?contact_id=${pacienteId}`)).status(),
      ).toBe(403);
      expect((await page.request.get("/api/v1/clinica/produtos")).status()).toBe(403);
    } finally {
      await admin.from("clinica_pacotes").delete().eq("contact_id", pacienteId);
      await admin
        .from("clinica_produtos")
        .delete()
        .eq("organization_id", orgId)
        .eq("nome", nomeDoProduto);
      await admin.from("clinica_multas").delete().eq("contact_id", pacienteId);
      await admin.from("calendar_appointments").delete().in("id", [jaAconteceu, emCimaDaHora]);
      await admin.from("contacts").delete().eq("id", pacienteId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
