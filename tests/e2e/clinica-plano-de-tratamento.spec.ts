/**
 * PLANO DE TRATAMENTO PELA TELA (fork TOQ, módulo clínica, migration 9006).
 *
 * O caminho, como na clínica:
 *   1. o fisioterapeuta assina a avaliação com 10 sessões, 2x por semana e a data da reavaliação;
 *   2. o prontuário mostra "Sessão 1 de 10", a etapa "Avaliado" e o retorno já marcado na agenda
 *      de quem avaliou, no dia pedido;
 *   3. o retorno existe de verdade na agenda, com o tipo "Reavaliação" da modalidade;
 *   4. depois de uma sessão atendida, a ficha (aba Resumo, a que a recepção usa) mostra
 *      "Sessão 2 de 10" e a etapa "Em tratamento".
 *
 * O tipo de agendamento, a jornada do profissional e a sessão atendida são semeados pelo service
 * role; a jornada anterior do administrador é devolvida no fim. O paciente é único por rodada:
 * registro assinado não se apaga.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const MINUTO = 60 * 1000;
const FUSO = "America/Sao_Paulo";
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-plano-de-tratamento");

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

/** `AAAA-MM-DD` de daqui a `dias`, no fuso da clínica. */
function diaDaClinica(dias: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(
    new Date(Date.now() + dias * 24 * 60 * MINUTO),
  );
}

test.describe("Plano de tratamento: da avaliação assinada ao retorno marcado", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("assinar a avaliação cria o plano, marca o retorno e conta as sessões", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const creds = lerCreds();
    if (!destinoEhLocal(URL_SUPABASE)) {
      throw new Error(`RECUSADO: ${URL_SUPABASE} não é loopback.`);
    }

    // O dono do servidor instala o módulo.
    await loginComoDono(page, creds);
    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-clinica");
    await expect(cartao).toBeVisible({ timeout: ESPERA });
    const instalar = page.getByTestId("instalar-clinica");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i)).toBeVisible({ timeout: ESPERA });

    // O administrador da empresa é o fisioterapeuta.
    await context.clearCookies();
    await loginComoAdmin(page, creds);
    const userId = await idDoUsuario(creds.users.admin!.email);
    const orgId = await orgDoUsuario(userId);

    await page.goto("/app/settings/tenant/clinica");
    const eu = (await (await page.request.get("/api/v1/clinica/eu")).json()) as {
      data: { profissional: unknown };
    };
    if (!eu.data.profissional) {
      await page.getByTestId("profissional-usuario").selectOption(userId);
      await page.getByTestId("profissional-nome").fill("Ana Fisio E2E");
      await page.getByTestId("profissional-registro").fill("123456-F");
      await page.getByLabel("Fisioterapia", { exact: true }).check();
      await page.getByTestId("cadastrar-profissional").click();
      await expect(page.getByText("Ana Fisio E2E").first()).toBeVisible({ timeout: ESPERA });
    }

    const sufixo = Date.now().toString(36);
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Reavaliação de fisioterapia ${sufixo}`,
        slug: `reavaliacao-fisio-${sufixo}`,
        duration_minutes: 50,
        minimum_notice_minutes: 0,
        booking_window_days: 90,
        default_owner_user_id: userId,
        is_active: true,
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

    // A jornada do profissional: todo dia, das 9h às 18h. A de antes volta no fim.
    const { data: jornadaAntes } = await admin
      .from("attendant_availability")
      .select("*")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    const { error: erroJornada } = await admin.from("attendant_availability").upsert(
      {
        organization_id: orgId,
        user_id: userId,
        is_available: true,
        schedule: {
          timezone: FUSO,
          windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "09:00", end: "18:00" })),
        },
      } as never,
      { onConflict: "organization_id,user_id" },
    );
    if (erroJornada) throw new Error(`attendant_availability upsert: ${erroJornada.message}`);

    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: `Paciente do plano ${sufixo}`,
        source: "manual",
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const pacienteId = (contato as { id: string }).id;

    const diaPedido = diaDaClinica(7);
    const criados: string[] = [];
    try {
      // 1. Assinar a avaliação com o plano.
      await page.goto(`/app/contacts/${pacienteId}?aba=prontuario`);
      await expect(page.getByTestId("registro-modalidade")).toBeVisible({ timeout: ESPERA });
      await page.getByTestId("registro-modalidade").selectOption("fisioterapia");
      await page.getByTestId("registro-tipo").selectOption("avaliacao");
      await page.getByLabel("Queixa principal").fill("Dor no ombro direito ao elevar o braço");
      await page.getByLabel("Diagnóstico fisioterapêutico").fill("Tendinopatia do supraespinhal");
      await page.getByLabel("Prognóstico").fill("Bom");
      await page.getByLabel("Objetivos do tratamento").fill("Elevar o braço sem dor");
      await page.getByLabel("Número de sessões previsto").fill("10");
      await page.getByLabel("Frequência semanal").fill("2");
      await page.getByTestId("registro-campo-data_reavaliacao").fill(diaPedido);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-avaliacao.png"), fullPage: true });
      await page.getByTestId("assinar-registro").click();

      // 2. O plano aparece no prontuário, com o retorno marcado.
      const plano = page.getByTestId("plano-fisioterapia");
      await expect(plano).toBeVisible({ timeout: ESPERA });
      await expect(plano.getByTestId("plano-sessao")).toHaveText("Sessão 1 de 10");
      await expect(plano.getByTestId("plano-etapa")).toHaveText("Avaliado");
      await expect(plano).toContainText("2x por semana");
      await expect(plano.getByTestId("plano-retorno")).toContainText("Retorno marcado", {
        timeout: ESPERA,
      });
      await page.screenshot({ path: path.join(EVIDENCIA, "2-plano-no-prontuario.png") });

      // 3. O retorno está na agenda de quem avaliou, no dia pedido, com o tipo da modalidade.
      const { data: linha } = await admin
        .from("clinica_planos_tratamento")
        .select("retorno_situacao, retorno_appointment_id, sessoes_previstas, reavaliacao_em")
        .eq("contact_id", pacienteId)
        .eq("situacao", "ativo")
        .single();
      const p = linha as {
        retorno_situacao: string;
        retorno_appointment_id: string | null;
        sessoes_previstas: number;
        reavaliacao_em: string;
      };
      expect(p.sessoes_previstas).toBe(10);
      expect(p.reavaliacao_em).toBe(diaPedido);
      expect(p.retorno_situacao).toBe("marcado");
      expect(p.retorno_appointment_id).toBeTruthy();
      criados.push(p.retorno_appointment_id!);
      const { data: retorno } = await admin
        .from("calendar_appointments")
        .select("owner_user_id, event_type_id, starts_at, contact_id")
        .eq("id", p.retorno_appointment_id!)
        .single();
      const r = retorno as {
        owner_user_id: string;
        event_type_id: string;
        starts_at: string;
        contact_id: string;
      };
      expect(r.owner_user_id).toBe(userId);
      expect(r.event_type_id).toBe(tipoId);
      expect(r.contact_id).toBe(pacienteId);
      expect(
        new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(r.starts_at)),
      ).toBe(diaPedido);

      // 4. Uma sessão atendida depois da avaliação: a ficha passa a "Sessão 2 de 10".
      const comeca = new Date(Date.now() + MINUTO);
      const { data: sessao, error: erroSessao } = await admin
        .from("calendar_appointments")
        .insert({
          organization_id: orgId,
          title: "Sessão de fisioterapia",
          starts_at: comeca.toISOString(),
          ends_at: new Date(comeca.getTime() + 50 * MINUTO).toISOString(),
          status: "completed",
          owner_user_id: userId,
          contact_id: pacienteId,
          event_type_id: tipoId,
          created_by_kind: "system",
          source: "ui",
        } as never)
        .select("id")
        .single();
      if (erroSessao || !sessao) throw new Error(`sessão insert: ${erroSessao?.message}`);
      criados.push((sessao as { id: string }).id);

      await page.goto(`/app/contacts/${pacienteId}`);
      const naFicha = page.getByTestId("plano-fisioterapia");
      await expect(naFicha).toBeVisible({ timeout: ESPERA });
      await expect(naFicha.getByTestId("plano-sessao")).toHaveText("Sessão 2 de 10");
      await expect(naFicha.getByTestId("plano-etapa")).toHaveText("Em tratamento");
      await expect(naFicha.getByTestId("plano-retorno")).toContainText("Retorno marcado");
      // O cartão não mostra nada clínico.
      await expect(naFicha).not.toContainText("Tendinopatia");
      await naFicha.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "3-plano-na-ficha.png") });
    } finally {
      await admin.from("crm_tasks").delete().eq("contact_id", pacienteId);
      if (criados.length) await admin.from("calendar_appointments").delete().in("id", criados);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
      if (jornadaAntes) {
        await admin
          .from("attendant_availability")
          .upsert(jornadaAntes as never, { onConflict: "organization_id,user_id" });
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
