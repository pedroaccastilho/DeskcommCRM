/**
 * O PAINEL FINANCEIRO NA INTERFACE NOVA (fork TOQ, módulo clínica, migration 9012).
 *
 * Pedido do Pedro (2026-10-15): "Pra galera que tem acesso ao financeiro, eu preciso que eles
 * tenham acesso à um cockpit de entradas e saídas, pra eles saberem oq ainda precisa cobrar do
 * cliente, oq já entrou, etc…". Esta spec prova pela tela, como o Administrador:
 *   - "Financeiro" está no menu e abre em "A cobrar", com o pacote vendido, a sessão avulsa
 *     realizada e a multa do paciente, cada um com o valor;
 *   - "Registrar pagamento" ali mesmo tira o pacote da lista e o põe em "Entradas";
 *   - "Registrar saída" lança uma despesa (aluguel, boleto), que aparece em "Saídas" e no banco;
 *   - a planilha "A cobrar" sai no padrão brasileiro, com o paciente;
 *   - apagar a saída a tira da lista;
 *   - no celular, sem rolagem lateral, e "Financeiro" fica no menu de "Você".
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { fimDoMes } from "../../lib/clinica/financeiro";
import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { fusoDaOrganizacaoLongeDaVirada } from "./helpers/virada-do-dia";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-financeiro");

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

test.describe("Painel financeiro na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a cobrar, registrar pagamento, registrar e apagar saída, planilha", async ({
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
        name: `Fisioterapia caixa ${sufixo}`,
        slug: `fisio-caixa-${sufixo}`,
        default_price_cents: 18000,
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
    // Um segundo tipo, de outra modalidade: a sessão marcada dele não é coberta pelo pacote de fisio.
    const { data: tipoPilates, error: erroPilates } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Pilates caixa ${sufixo}`,
        slug: `pilates-caixa-${sufixo}`,
        default_price_cents: 9000,
        duration_minutes: 50,
        minimum_notice_minutes: 0,
        booking_window_days: 60,
        is_active: true,
      } as never)
      .select("id")
      .single();
    if (erroPilates || !tipoPilates) throw new Error(`pilates insert: ${erroPilates?.message}`);
    const tipoPilatesId = (tipoPilates as { id: string }).id;
    await admin.from("clinica_tipos_atendimento").insert({
      organization_id: orgId,
      event_type_id: tipoPilatesId,
      modalidade: "pilates",
    } as never);

    const nome = `Vera Caixa ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nome, phone_number: `+5511966${sufixo}` } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;
    const descricaoDaSaida = `Aluguel da sala ${sufixo}`;

    // O fuso da organização longe da virada do dia: "Este mês" contém o que semeamos agora.
    const desfazerFuso = await fusoDaOrganizacaoLongeDaVirada(admin, orgId, 60, 180);
    try {
      const agora = Date.now();
      const sessaoBase = {
        organization_id: orgId,
        title: `Fisioterapia caixa ${sufixo}`,
        owner_user_id: userId,
        contact_id: contactId,
        event_type_id: tipoId,
        created_by_kind: "system",
        source: "ui",
      };
      const { data: sessoes, error: erroSessao } = await admin
        .from("calendar_appointments")
        .insert([
          {
            ...sessaoBase,
            starts_at: new Date(agora - 3 * 3_600_000).toISOString(),
            ends_at: new Date(agora - 3 * 3_600_000 + 50 * 60_000).toISOString(),
            status: "completed",
          },
          {
            ...sessaoBase,
            starts_at: new Date(agora - 5 * 3_600_000).toISOString(),
            ends_at: new Date(agora - 5 * 3_600_000 + 50 * 60_000).toISOString(),
            status: "no_show",
          },
          // A agenda: uma fisio marcada (o pacote cobre) e um pilates marcado (vai entrar R$ 90).
          {
            ...sessaoBase,
            starts_at: new Date(agora + 60 * 60_000).toISOString(),
            ends_at: new Date(agora + 110 * 60_000).toISOString(),
            status: "pending",
          },
          {
            ...sessaoBase,
            title: `Pilates caixa ${sufixo}`,
            event_type_id: tipoPilatesId,
            starts_at: new Date(agora + 120 * 60_000).toISOString(),
            ends_at: new Date(agora + 170 * 60_000).toISOString(),
            status: "confirmed",
          },
        ] as never)
        .select("id, status");
      if (erroSessao || !sessoes) throw new Error(`appointments insert: ${erroSessao?.message}`);
      const linhas = sessoes as Array<{ id: string; status: string }>;
      const faltaId = linhas.find((s) => s.status === "no_show")!.id;

      const { error: erroMulta } = await admin.from("clinica_multas").insert({
        organization_id: orgId,
        appointment_id: faltaId,
        contact_id: contactId,
        percentual: 30,
        antecedencia_horas: -0.5,
        valor_cents: 5400,
        origem: "falta",
      } as never);
      if (erroMulta) throw new Error(`clinica_multas insert: ${erroMulta.message}`);

      const { data: pacote, error: erroPacote } = await admin
        .from("clinica_pacotes")
        .insert({
          organization_id: orgId,
          contact_id: contactId,
          nome: `Pacote caixa ${sufixo}`,
          modalidade: "fisioterapia",
          sessoes_total: 10,
          valor_cents: 140000,
          comprado_em: new Date(agora - 3_600_000).toISOString(),
          valido_ate: new Date(agora + 60 * 86_400_000).toISOString(),
          aceite_politica_em: new Date(agora - 3_600_000).toISOString(),
          aceite_multa_pct: 30,
          aceite_antecedencia_horas: 24,
        } as never)
        .select("id")
        .single();
      if (erroPacote || !pacote) throw new Error(`clinica_pacotes insert: ${erroPacote?.message}`);
      const pacoteId = (pacote as { id: string }).id;

      // ── 1. A porta no menu e a lista do que falta cobrar ──────────────────────
      await page.goto("/hoje");
      // "Este mês", o padrão, pede o mês inteiro: o que vem depois de hoje é a previsão.
      const pedidoDoPainel = page.waitForRequest((r) =>
        r.url().includes("/api/v1/clinica/financeiro?"),
      );
      await page.locator(".n-trilho").getByRole("link", { name: "Financeiro" }).click();
      await expect(page).toHaveURL(/\/financeiro$/, { timeout: ESPERA });
      const ate = new URL((await pedidoDoPainel).url()).searchParams.get("ate")!;
      expect(ate, 'o "Este mês" vai até o último dia do mês').toBe(fimDoMes(ate));
      const tela = page.getByTestId("novo-financeiro");
      await expect(tela.getByRole("heading", { name: "Financeiro" })).toBeVisible({
        timeout: ESPERA,
      });
      const aCobrar = page.getByTestId("novo-financeiro-item-a-receber").filter({ hasText: nome });
      await expect(aCobrar).toHaveCount(3, { timeout: ESPERA });
      await expect(aCobrar.filter({ hasText: "Pacote" })).toContainText("1.400,00");
      await expect(aCobrar.filter({ hasText: "Sessão avulsa" })).toContainText("180,00");
      await expect(aCobrar.filter({ hasText: "Multa por falta" })).toContainText("54,00");
      await expect(page.getByTestId("novo-financeiro-a-receber")).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "1-a-cobrar.png"), fullPage: true });

      // ── 2. Registrar o pagamento do pacote ali mesmo ──────────────────────────
      await aCobrar
        .filter({ hasText: "Pacote" })
        .getByTestId("novo-financeiro-registrar-pagamento")
        .click();
      const folhaPagamento = page.getByTestId("novo-folha-pagamento");
      await expect(folhaPagamento.getByTestId("novo-valor-do-pagamento")).toHaveValue("1400,00");
      await folhaPagamento.getByTestId("novo-forma-pix").click();
      await folhaPagamento.getByTestId("novo-confirmar-pagamento").click();
      await expect(page.getByText("Pagamento registrado.")).toBeVisible({ timeout: ESPERA });
      await expect(aCobrar).toHaveCount(2, { timeout: ESPERA });

      // ── 2b. O que a agenda diz que vai entrar ─────────────────────────────────
      await page.getByTestId("novo-financeiro-previsao").click();
      const previsto = page.getByTestId("novo-financeiro-item-previsto").filter({ hasText: nome });
      await expect(previsto).toHaveCount(2, { timeout: ESPERA });
      await expect(previsto.filter({ hasText: "Pilates" })).toContainText("90,00");
      await expect(previsto.filter({ hasText: "Fisioterapia" })).toContainText("Pacote");
      await expect(page.getByTestId("novo-financeiro-lista-previsao")).toContainText(
        "1 sessão coberta por pacote fica fora da soma.",
      );
      await page.screenshot({ path: path.join(EVIDENCIA, "2-vai-entrar.png"), fullPage: true });

      await page.getByTestId("novo-financeiro-aba-entradas").click();
      const entrada = page.getByTestId("novo-financeiro-entrada").filter({ hasText: nome });
      await expect(entrada).toHaveCount(1, { timeout: ESPERA });
      await expect(entrada).toContainText("Pix");
      await expect(entrada).toContainText("1.400,00");
      const { data: pagos } = await admin
        .from("clinica_pagamentos")
        .select("forma, valor_cents")
        .eq("pacote_id", pacoteId);
      expect(pagos).toEqual([{ forma: "pix", valor_cents: 140000 }]);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-entradas.png"), fullPage: true });

      // ── 3. Registrar uma saída ────────────────────────────────────────────────
      await page.getByTestId("novo-financeiro-aba-saidas").click();
      await page.getByTestId("novo-financeiro-registrar-saida").click();
      const folhaSaida = page.getByTestId("novo-folha-saida");
      await expect(folhaSaida.getByTestId("novo-confirmar-saida")).toBeDisabled();
      await folhaSaida.getByTestId("novo-saida-descricao").fill(descricaoDaSaida);
      await folhaSaida.getByTestId("novo-saida-categoria").selectOption("aluguel");
      await folhaSaida.getByTestId("novo-saida-forma-boleto").click();
      await folhaSaida.getByTestId("novo-saida-valor").fill("2500,00");
      await page.screenshot({ path: path.join(EVIDENCIA, "3-registrar-saida.png") });
      await folhaSaida.getByTestId("novo-confirmar-saida").click();
      await expect(page.getByText("Saída registrada.")).toBeVisible({ timeout: ESPERA });
      const saida = page.getByTestId("novo-financeiro-saida").filter({ hasText: descricaoDaSaida });
      await expect(saida).toContainText("Aluguel", { timeout: ESPERA });
      await expect(saida).toContainText("Boleto");
      await expect(saida).toContainText("2.500,00");
      const { data: despesas } = await admin
        .from("clinica_despesas")
        .select("categoria, forma, valor_cents, organization_id")
        .eq("descricao", descricaoDaSaida);
      expect(despesas).toEqual([
        { categoria: "aluguel", forma: "boleto", valor_cents: 250000, organization_id: orgId },
      ]);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-saidas.png"), fullPage: true });

      // ── 4. A planilha do que falta cobrar ─────────────────────────────────────
      const href = await page
        .getByTestId("novo-financeiro-exportar-a-receber")
        .getAttribute("href");
      const planilha = await page.request.get(href!);
      expect(planilha.status()).toBe(200);
      expect(planilha.headers()["content-type"]).toContain("text/csv");
      const csv = await planilha.text();
      expect(csv.split("\r\n")[0]).toBe("\uFEFFDesde;Paciente;O que;Descrição;Valor (R$);Moeda");
      expect(csv).toContain(`${nome};Sessões avulsas;`);
      expect(csv).toContain(";54,00;BRL");
      expect(csv).not.toContain(`Pacote caixa ${sufixo}`);

      // ── 5. Apagar a saída lançada por engano ──────────────────────────────────
      page.once("dialog", (d) => void d.accept());
      await saida.getByTestId("novo-financeiro-apagar-saida").click();
      await expect(page.getByText("Saída apagada.")).toBeVisible({ timeout: ESPERA });
      await expect(saida).toHaveCount(0, { timeout: ESPERA });

      // ── 6. Notebook de tela baixa: o avatar (menu da pessoa) continua dentro da janela ──
      await page.setViewportSize({ width: 1280, height: 720 });
      const fimDoTrilho = await page
        .locator("nav.n-trilho > div > *")
        .last()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(fimDoTrilho, "o avatar do trilho cabe numa janela de 720 px").toBeLessThanOrEqual(720);
      await page.screenshot({ path: path.join(EVIDENCIA, "5-notebook-720.png") });

      // ── 7. Celular: sem rolagem lateral; Financeiro no menu de "Você" ─────────
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("novo-financeiro-aba-a_receber").click();
      await expect(aCobrar).toHaveCount(2, { timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "6-celular.png"), fullPage: true });
      await page.locator(".n-abas").getByRole("button").last().click();
      await expect(page.getByTestId("novo-menu-financeiro")).toBeVisible({ timeout: ESPERA });
    } finally {
      await desfazerFuso();
      await admin.from("clinica_despesas").delete().eq("descricao", descricaoDaSaida);
      await admin.from("clinica_pagamentos").delete().eq("contact_id", contactId);
      await admin.from("clinica_multas").delete().eq("contact_id", contactId);
      await admin.from("clinica_pacotes").delete().eq("contact_id", contactId);
      await admin.from("calendar_appointments").delete().eq("contact_id", contactId);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoPilatesId);
      await admin.from("calendar_event_types").delete().in("id", [tipoId, tipoPilatesId]);
    }
  });
});
