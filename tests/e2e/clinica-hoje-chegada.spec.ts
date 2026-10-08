/**
 * O BALCÃO E O MEU DIA NO HOJE DA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * Com a chave "A equipe usa só a interface nova", Balcão e Meu dia levam ao /hoje. Esta spec
 * prova, pela tela, que o que eles faziam está lá:
 *   - quem vê a clínica marca "Chegou" na folha da sessão, o paciente vai para "Na clínica" com a
 *     hora da chegada, e "Desfazer chegada" devolve;
 *   - quem atende ("Ver a tela de: Profissional de saúde") toca "Iniciar atendimento";
 *   - a evolução mostra a última sessão e repete a conduta; depois de assinar, a folha pergunta
 *     "Qual o próximo passo?" e marca a próxima sessão daqui a uma semana.
 * Confere no banco a etapa, o registro e a sessão marcada.
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
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-hoje-chegada");

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

test.describe("Balcão e Meu dia no Hoje da interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("chegada, atendimento e próximo passo pela folha da sessão", async ({ page, context }) => {
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

    // O administrador também atende: cadastra-se como fisioterapeuta, se ainda não for.
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
    const eu = (await (await page.request.get("/api/v1/clinica/eu")).json()) as {
      data: { profissional: unknown };
    };
    if (!eu.data.profissional) {
      await page.goto("/app/settings/tenant/clinica");
      await page.getByTestId("profissional-usuario").selectOption(userId);
      await page.getByTestId("profissional-nome").fill("Ana Fisio E2E");
      await page.getByTestId("profissional-registro").fill("123456-F");
      await page.getByLabel("Fisioterapia", { exact: true }).check();
      await page.getByTestId("cadastrar-profissional").click();
      await expect(page.getByText("Ana Fisio E2E").first()).toBeVisible({ timeout: ESPERA });
    }

    // Para marcar a próxima sessão, o profissional precisa ter publicado horários de atendimento.
    // Guarda o que havia e devolve no fim: outras specs usam o mesmo administrador.
    const { data: dispAntes } = await admin
      .from("attendant_availability")
      .select("organization_id, user_id, is_available, schedule")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    const { error: erroDisp } = await admin.from("attendant_availability").upsert(
      {
        organization_id: orgId,
        user_id: userId,
        is_available: true,
        schedule: {
          timezone: "America/Sao_Paulo",
          windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "08:00", end: "20:00" })),
        },
      } as never,
      { onConflict: "organization_id,user_id" },
    );
    if (erroDisp) throw new Error(`attendant_availability upsert: ${erroDisp.message}`);

    const sufixo = String(Date.now()).slice(-7);
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Fisioterapia hoje ${sufixo}`,
        slug: `fisio-hoje-${sufixo}`,
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

    const nome = `Lia Hoje ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nome, phone_number: `+5511988${sufixo}` } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    const comeca = new Date(Date.now() + 10 * 60_000);
    comeca.setSeconds(0, 0);
    const { data: sessao, error: erroSessao } = await admin
      .from("calendar_appointments")
      .insert({
        organization_id: orgId,
        title: `Fisioterapia hoje ${sufixo}`,
        starts_at: comeca.toISOString(),
        ends_at: new Date(comeca.getTime() + 50 * 60_000).toISOString(),
        status: "confirmed",
        owner_user_id: userId,
        contact_id: contactId,
        event_type_id: tipoId,
        created_by_kind: "system",
        source: "ui",
      } as never)
      .select("id")
      .single();
    if (erroSessao || !sessao)
      throw new Error(`calendar_appointments insert: ${erroSessao?.message}`);
    const sessaoId = (sessao as { id: string }).id;
    let proximaId: string | null = null;

    // A sessão é daqui a 10 min: perto da meia-noite ela cairia amanhã e sumiria da fila de hoje.
    const desfazerFuso = await fusoDaOrganizacaoLongeDaVirada(admin, orgId, 30, 120);
    try {
      // A sessão anterior, para a evolução de hoje mostrar a última e repetir a conduta.
      const anterior = await page.request.post("/api/v1/clinica/prontuario", {
        data: {
          contact_id: contactId,
          modalidade: "fisioterapia",
          tipo: "evolucao",
          appointment_id: null,
          adendo_de: null,
          conteudo: { dor: 6, conduta: "Fortalecimento de glúteo médio", plano: "Progredir carga" },
          texto: null,
        },
      });
      expect(anterior.status(), await anterior.text()).toBeLessThan(300);

      // Quem vê a clínica: o administrador na tela de gestão.
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
      await page.reload();
      const linha = page.getByTestId("novo-linha-sessao").filter({ hasText: nome });
      await expect(linha).toBeVisible({ timeout: ESPERA });
      // O atalho da linha é o mesmo passo principal do Balcão.
      await expect(linha.getByTestId("novo-linha-etapa")).toHaveText("Chegou");
      await linha.getByRole("button").first().click();
      const folha = page.getByTestId("novo-folha-sessao");
      await expect(folha.getByTestId("novo-chegou")).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-chegou")).toHaveClass(/n-botao-principal/);
      await folha.getByTestId("novo-chegou").click();
      await expect(page.getByText("Chegada registrada.")).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-selo-da-sessao")).toHaveText("Na recepção", {
        timeout: ESPERA,
      });
      await expect(folha.getByTestId("novo-hora-da-chegada")).toContainText(
        "Aguardando na recepção.",
      );
      await expect(folha.getByTestId("novo-chegou")).toHaveCount(0);
      await page.screenshot({
        path: path.join(EVIDENCIA, "1-folha-na-recepcao.png"),
        fullPage: true,
      });

      // Marcou por engano: desfaz, e volta a ser "Confirmado".
      await folha.getByTestId("novo-desfazer-chegada").click();
      await expect(page.getByText("Chegada desfeita.")).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-selo-da-sessao")).toHaveText("Confirmado", {
        timeout: ESPERA,
      });
      await folha.getByTestId("novo-chegou").click();
      await expect(folha.getByTestId("novo-selo-da-sessao")).toHaveText("Na recepção", {
        timeout: ESPERA,
      });
      await page.keyboard.press("Escape");
      await expect(folha).toHaveCount(0, { timeout: ESPERA });
      // "Na clínica": a lista que o filtro do Balcão mostrava.
      const naClinica = page.locator("section").filter({
        has: page.getByRole("heading", { name: /^Na clínica/ }),
      });
      await expect(naClinica.getByTestId("novo-linha-sessao")).toContainText(nome, {
        timeout: ESPERA,
      });
      await page.screenshot({
        path: path.join(EVIDENCIA, "2-hoje-na-clinica.png"),
        fullPage: true,
      });

      // Quem atende: a tela do profissional de saúde, como o Meu dia.
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "saude"));
      await page.reload();
      const minha = page.getByTestId("novo-linha-sessao").filter({ hasText: nome });
      await expect(minha.getByTestId("novo-linha-etapa")).toHaveText("Iniciar", {
        timeout: ESPERA,
      });
      await minha.getByRole("button").first().click();
      await expect(folha.getByTestId("novo-iniciar-atendimento")).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-desfazer-chegada")).toHaveCount(0);
      await folha.getByTestId("novo-iniciar-atendimento").click();
      await expect(page.getByText("Atendimento iniciado.")).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-hora-da-chegada")).toContainText(
        "Em atendimento desde as",
        { timeout: ESPERA },
      );
      await expect(folha.getByTestId("novo-iniciar-atendimento")).toHaveCount(0);
      await expect(folha.getByTestId("novo-realizado")).toHaveClass(/n-botao-principal/);
      await page.screenshot({
        path: path.join(EVIDENCIA, "3-folha-em-atendimento.png"),
        fullPage: true,
      });

      const { data: etapa } = await admin
        .from("clinica_sessao_etapas")
        .select("chegou_em, atendimento_iniciado_em")
        .eq("appointment_id", sessaoId)
        .single();
      const gravada = etapa as { chegou_em: string | null; atendimento_iniciado_em: string | null };
      expect(gravada.chegou_em).not.toBeNull();
      expect(gravada.atendimento_iniciado_em).not.toBeNull();

      // A evolução: a última sessão, repetir a conduta, dor 3, e assina.
      await folha.getByRole("button", { name: /Escrever a evolução/ }).click();
      const evolucao = page.getByTestId("novo-folha-evolucao");
      await expect(evolucao.getByTestId("novo-ultima-sessao")).toContainText(
        "Fortalecimento de glúteo médio",
        { timeout: ESPERA },
      );
      await evolucao.getByTestId("novo-repetir-conduta").click();
      await expect(evolucao.getByLabel(/^Conduta/)).toHaveValue("Fortalecimento de glúteo médio");
      await evolucao
        .getByRole("group", { name: /^Dor/ })
        .getByRole("button", { name: "3", exact: true })
        .click();
      await evolucao.getByLabel(/^Queixa principal/).fill("Dor ao subir escada, melhorando");
      await page.screenshot({
        path: path.join(EVIDENCIA, "4-evolucao-pronta.png"),
        fullPage: true,
      });
      await evolucao.getByRole("button", { name: /^Assinar/ }).click();
      const proximoPasso = page.getByTestId("novo-evolucao-assinada");
      await expect(proximoPasso).toContainText("Qual o próximo passo?", { timeout: ESPERA });
      await expect(proximoPasso).toContainText(
        "Este paciente ainda não tem a próxima sessão marcada.",
        { timeout: ESPERA },
      );
      const { data: gravados } = await admin
        .from("prontuario_registros")
        .select("conteudo")
        .eq("contact_id", contactId)
        .eq("appointment_id", sessaoId);
      expect(gravados).toHaveLength(1);
      expect((gravados![0] as { conteudo: Record<string, unknown> }).conteudo).toMatchObject({
        dor: 3,
        conduta: "Fortalecimento de glúteo médio",
      });

      // Próximo passo: marcar a próxima sessão, que abre daqui a uma semana.
      await proximoPasso.getByTestId("novo-marcar-proxima").click();
      const horarios = folha.getByTestId("novo-horarios-livres");
      await expect(horarios).toBeVisible({ timeout: ESPERA });
      await page.screenshot({ path: path.join(EVIDENCIA, "5-proxima-sessao.png"), fullPage: true });
      await horarios.getByRole("button").first().click();
      await folha.getByRole("button", { name: /^Marcar para/ }).click();
      await expect(proximoPasso.getByTestId("novo-proxima-ja-marcada")).toBeVisible({
        timeout: ESPERA,
      });
      await expect(proximoPasso.getByTestId("novo-marcar-proxima")).toHaveText(
        "Marcar outra sessão",
      );
      await page.screenshot({
        path: path.join(EVIDENCIA, "6-proxima-marcada.png"),
        fullPage: true,
      });

      const { data: marcadas } = await admin
        .from("calendar_appointments")
        .select("id, starts_at, owner_user_id, event_type_id")
        .eq("contact_id", contactId)
        .neq("id", sessaoId);
      expect(marcadas).toHaveLength(1);
      const marcada = marcadas![0] as {
        id: string;
        starts_at: string;
        owner_user_id: string;
        event_type_id: string;
      };
      proximaId = marcada.id;
      expect(marcada.owner_user_id).toBe(userId);
      expect(marcada.event_type_id).toBe(tipoId);
      const diasAte = (new Date(marcada.starts_at).getTime() - Date.now()) / 86_400_000;
      expect(diasAte).toBeGreaterThan(5);
      expect(diasAte).toBeLessThan(8);

      // Celular, sem rolagem lateral.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(proximoPasso).toBeVisible();
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "7-celular.png"), fullPage: true });
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      await desfazerFuso();
      if (proximaId) await admin.from("calendar_appointments").delete().eq("id", proximaId);
      await admin.from("calendar_appointments").delete().eq("id", sessaoId);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
      if (dispAntes) {
        await admin
          .from("attendant_availability")
          .upsert(dispAntes as never, { onConflict: "organization_id,user_id" });
      } else {
        await admin
          .from("attendant_availability")
          .delete()
          .eq("organization_id", orgId)
          .eq("user_id", userId);
      }
    }
  });
});
