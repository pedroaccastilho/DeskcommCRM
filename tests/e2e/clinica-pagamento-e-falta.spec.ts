/**
 * PAGAMENTO E MULTA POR FALTA NA INTERFACE NOVA (fork TOQ, módulo clínica, migration 9011).
 *
 * Pedido do Pedro (2026-10-15): dizer se o paciente já pagou, e como, o pacote, a consulta avulsa
 * e a multa; e, ao marcar "Faltou", decidir se a clínica cobra a multa. Esta spec prova pela tela:
 *   - a folha da sessão avulsa mostra "A pagar"; "Faltou" pergunta se cobra a multa, e "Sim"
 *     lança a multa da falta (30% do preço do tipo), a cobrar;
 *   - na ficha, a multa da falta tem "Registrar pagamento": Pix, e ela passa a paga;
 *   - na venda do pacote, "O paciente já pagou?" registra o pagamento junto;
 *   - no histórico, a sessão avulsa realizada tem "Registrar pagamento", com o preço do tipo.
 * Confere no banco a falta, a multa, cada pagamento e a forma.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { fusoDaOrganizacaoLongeDaVirada } from "./helpers/virada-do-dia";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-pagamento-e-falta");

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

test.describe("Pagamento e multa por falta na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("falta com multa, pagamento da multa, do pacote e da sessão avulsa", async ({
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

    const sufixo = String(Date.now()).slice(-7);
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Fisioterapia pagamento ${sufixo}`,
        slug: `fisio-pagamento-${sufixo}`,
        default_price_cents: 15000,
        duration_minutes: 50,
        minimum_notice_minutes: 0,
        booking_window_days: 60,
        is_active: true,
      } as never)
      .select("id")
      .single();
    if (erroTipo || !tipo) throw new Error(`calendar_event_types insert: ${erroTipo?.message}`);
    const tipoId = (tipo as { id: string }).id;
    await admin.from("clinica_tipos_atendimento").insert({
      organization_id: orgId,
      event_type_id: tipoId,
      modalidade: "fisioterapia",
    } as never);

    const nome = `Rui Pagamento ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nome, phone_number: `+5511977${sufixo}` } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    const sessaoBase = {
      organization_id: orgId,
      title: `Fisioterapia pagamento ${sufixo}`,
      owner_user_id: userId,
      contact_id: contactId,
      event_type_id: tipoId,
      created_by_kind: "system",
      source: "ui",
    };
    // Começou há 30 min (a tolerância de 15 já passou): é a que vai faltar.
    const comecou = new Date(Date.now() - 30 * 60_000);
    comecou.setSeconds(0, 0);
    // Realizada anteontem, fora de pacote: a avulsa do histórico.
    const anteontem = new Date(Date.now() - 2 * 86_400_000);
    const { data: sessoes, error: erroSessao } = await admin
      .from("calendar_appointments")
      .insert([
        {
          ...sessaoBase,
          starts_at: comecou.toISOString(),
          ends_at: new Date(comecou.getTime() + 50 * 60_000).toISOString(),
          status: "confirmed",
        },
        {
          ...sessaoBase,
          starts_at: anteontem.toISOString(),
          ends_at: new Date(anteontem.getTime() + 50 * 60_000).toISOString(),
          status: "completed",
        },
      ] as never)
      .select("id, status");
    if (erroSessao || !sessoes) throw new Error(`appointments insert: ${erroSessao?.message}`);
    const linhas = sessoes as Array<{ id: string; status: string }>;
    const faltaId = linhas.find((s) => s.status === "confirmed")!.id;
    const avulsaId = linhas.find((s) => s.status === "completed")!.id;

    const desfazerFuso = await fusoDaOrganizacaoLongeDaVirada(admin, orgId, 60, 120);
    try {
      // ── 1. A falta, com a multa ───────────────────────────────────────────────
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
      await page.reload();
      const linha = page.getByTestId("novo-linha-sessao").filter({ hasText: nome });
      await expect(linha).toBeVisible({ timeout: ESPERA });
      await linha.getByRole("button").first().click();
      const folha = page.getByTestId("novo-folha-sessao");
      // Sessão avulsa (sem pacote): o pagamento dela aparece, ainda a pagar.
      await expect(folha.getByTestId("novo-pagamento-da-sessao")).toContainText("A pagar", {
        timeout: ESPERA,
      });
      await folha.getByTestId("novo-faltou").click();
      const passo = folha.getByTestId("novo-passo-faltou");
      await expect(passo.getByText("Vamos cobrar multa pela falta?")).toBeVisible();
      // Sem escolher, não registra.
      await expect(passo.getByTestId("novo-confirmar-falta")).toBeDisabled();
      await expect(passo.getByTestId("novo-falta-cobrar")).toContainText("45,00");
      await page.screenshot({ path: path.join(EVIDENCIA, "1-faltou-pergunta-a-multa.png") });
      await passo.getByTestId("novo-falta-cobrar").click();
      await passo.getByTestId("novo-confirmar-falta").click();
      await expect(page.getByText(/Falta registrada\. Multa de .*45,00 lançada/)).toBeVisible({
        timeout: ESPERA,
      });

      const { data: faltou } = await admin
        .from("calendar_appointments")
        .select("status")
        .eq("id", faltaId)
        .single();
      expect((faltou as { status: string }).status).toBe("no_show");
      const { data: multas } = await admin
        .from("clinica_multas")
        .select("id, origem, percentual, valor_cents, status")
        .eq("appointment_id", faltaId);
      expect(multas).toHaveLength(1);
      const multa = multas![0] as {
        id: string;
        origem: string;
        percentual: number;
        valor_cents: number;
        status: string;
      };
      expect(multa).toMatchObject({
        origem: "falta",
        percentual: 30,
        valor_cents: 4500,
        status: "pendente",
      });

      // ── 2. A ficha: pagar a multa com Pix ─────────────────────────────────────
      await page.goto(`/pacientes/${contactId}`);
      const cartaoMultas = page.getByTestId("novo-multas");
      await expect(cartaoMultas).toContainText("Falta", { timeout: ESPERA });
      await cartaoMultas.getByTestId("novo-registrar-pagamento").click();
      const folhaPagamento = page.getByTestId("novo-folha-pagamento");
      await expect(folhaPagamento.getByTestId("novo-valor-do-pagamento")).toHaveValue("45,00");
      await expect(folhaPagamento.getByTestId("novo-confirmar-pagamento")).toBeDisabled();
      await folhaPagamento.getByTestId("novo-forma-pix").click();
      await page.screenshot({ path: path.join(EVIDENCIA, "2-pagar-a-multa.png") });
      await folhaPagamento.getByTestId("novo-confirmar-pagamento").click();
      await expect(page.getByText("Pagamento registrado.")).toBeVisible({ timeout: ESPERA });
      await expect(cartaoMultas.getByTestId("novo-pago")).toContainText("Pix", {
        timeout: ESPERA,
      });
      await expect(cartaoMultas).toContainText("Paga");
      const { data: multaPaga } = await admin
        .from("clinica_multas")
        .select("status")
        .eq("id", multa.id)
        .single();
      expect((multaPaga as { status: string }).status).toBe("paga");

      // ── 3. O histórico: a sessão avulsa realizada, paga no débito ─────────────
      const historico = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: /^Histórico recente/ }) });
      await historico.getByTestId("novo-registrar-pagamento").first().click();
      await expect(folhaPagamento).toBeVisible({ timeout: ESPERA });
      await folhaPagamento.getByTestId("novo-forma-cartao_debito").click();
      await folhaPagamento.getByTestId("novo-confirmar-pagamento").click();
      await expect(historico.getByTestId("novo-pago").first()).toContainText("Cartão de débito", {
        timeout: ESPERA,
      });

      // ── 4. Vender o pacote já pago, em dinheiro ───────────────────────────────
      await page.getByTestId("novo-vender-pacote").click();
      const venda = page.getByTestId("novo-folha-vender-pacote");
      await venda.getByText("Pacote padrão de Fisioterapia").click();
      await venda.getByPlaceholder("0,00").fill("1200,00");
      await venda.getByTestId("novo-aceite-da-politica").check();
      await expect(venda.getByText("O paciente já pagou?")).toBeVisible();
      await venda.getByTestId("novo-forma-dinheiro").click();
      await page.screenshot({ path: path.join(EVIDENCIA, "3-venda-ja-paga.png") });
      await venda.getByTestId("novo-confirmar-venda").click();
      await expect(page.getByText("Pacote vendido e pagamento registrado.")).toBeVisible({
        timeout: ESPERA,
      });
      const pacotes = page.getByTestId("novo-pacotes");
      await expect(pacotes.getByTestId("novo-pago")).toContainText("Dinheiro", {
        timeout: ESPERA,
      });
      await page.screenshot({
        path: path.join(EVIDENCIA, "4-ficha-com-pagamentos.png"),
        fullPage: true,
      });

      const { data: pagamentos } = await admin
        .from("clinica_pagamentos")
        .select("pacote_id, appointment_id, multa_id, forma, valor_cents")
        .eq("contact_id", contactId);
      const lista = (pagamentos ?? []) as Array<{
        pacote_id: string | null;
        appointment_id: string | null;
        multa_id: string | null;
        forma: string;
        valor_cents: number | null;
      }>;
      expect(lista).toHaveLength(3);
      expect(lista.find((p) => p.multa_id === multa.id)).toMatchObject({
        forma: "pix",
        valor_cents: 4500,
      });
      expect(lista.find((p) => p.appointment_id === avulsaId)).toMatchObject({
        forma: "cartao_debito",
        valor_cents: 15000,
      });
      expect(lista.find((p) => p.pacote_id !== null)).toMatchObject({
        forma: "dinheiro",
        valor_cents: 120000,
      });

      // Marcou errado: desfaz o da multa, e ela volta a cobrar.
      await page.getByTestId("novo-multas").getByTestId("novo-desfazer-pagamento").click();
      await expect(page.getByText("Pagamento desfeito. Voltou para a pagar.")).toBeVisible({
        timeout: ESPERA,
      });
      await expect(page.getByTestId("novo-multas")).toContainText("A cobrar", { timeout: ESPERA });

      // Celular, sem rolagem lateral.
      await page.setViewportSize({ width: 390, height: 844 });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "5-celular.png"), fullPage: true });
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      await desfazerFuso();
      await admin.from("clinica_pagamentos").delete().eq("contact_id", contactId);
      await admin.from("clinica_multas").delete().eq("contact_id", contactId);
      await admin.from("calendar_appointments").delete().eq("contact_id", contactId);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
