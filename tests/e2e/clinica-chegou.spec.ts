/**
 * CHEGOU E EM ATENDIMENTO (fork TOQ, módulo clínica).
 *
 * A recepção marca no Balcão que o paciente chegou; o paciente sai de "a caminho" e passa a
 * aparecer "Na recepção", sem risco de levar falta. O profissional vê no Meu dia que o paciente
 * está esperando e toca "Iniciar atendimento"; o Balcão passa a mostrar "Em atendimento". A spec
 * confere a linha gravada no banco.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA = process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-chegou");

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

test.describe("Chegou e em atendimento com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a recepção marca a chegada e o profissional inicia o atendimento", async ({
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
        name: `Fisioterapia chegou ${sufixo}`,
        slug: `fisio-chegou-${sufixo}`,
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

    const nome = `Lia Chegou ${sufixo}`;
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
        title: `Fisioterapia chegou ${sufixo}`,
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

    try {
      // Recepção: o paciente chegou.
      await page.goto("/app/clinica/balcao");
      await page.getByTestId(`fila-${sessaoId}`).click();
      const painel = page.getByTestId("painel-do-paciente");
      await expect(painel).toContainText(nome, { timeout: ESPERA });
      await painel.getByTestId("acao-chegou").click();
      await expect(page.getByText("Chegada registrada.")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId(`fila-${sessaoId}`)).toContainText("Na recepção", {
        timeout: ESPERA,
      });
      await expect(painel.getByTestId("hora-da-chegada")).toContainText("Aguardando na recepção");
      await expect(page.getByTestId("filtro-na_clinica")).toContainText("1");
      await page.screenshot({
        path: path.join(EVIDENCIA, "balcao-na-recepcao.png"),
        fullPage: true,
      });

      // Profissional: vê que o paciente está esperando e começa.
      await page.goto("/app/clinica/meu-dia");
      await page.getByTestId(`horario-${sessaoId}`).click();
      const modo = page.getByTestId("modo-atendimento");
      await expect(modo.getByTestId("hora-da-chegada")).toContainText("está na recepção", {
        timeout: ESPERA,
      });
      await modo.getByTestId("acao-iniciar-atendimento").click();
      await expect(page.getByText("Atendimento iniciado.")).toBeVisible({ timeout: ESPERA });
      await expect(modo.getByTestId("hora-da-chegada")).toContainText("Em atendimento desde", {
        timeout: ESPERA,
      });
      await expect(modo.getByTestId("acao-iniciar-atendimento")).toHaveCount(0);
      await expect(modo.getByTestId("acao-compareceu")).toBeVisible();
      await page.screenshot({
        path: path.join(EVIDENCIA, "meu-dia-em-atendimento.png"),
        fullPage: true,
      });

      const { data: etapa } = await admin
        .from("clinica_sessao_etapas")
        .select("chegou_em, atendimento_iniciado_em")
        .eq("appointment_id", sessaoId)
        .single();
      const linha = etapa as { chegou_em: string | null; atendimento_iniciado_em: string | null };
      expect(linha.chegou_em).not.toBeNull();
      expect(linha.atendimento_iniciado_em).not.toBeNull();

      // De volta ao Balcão: em atendimento, sem botão de chegada nem de desfazer.
      await page.goto("/app/clinica/balcao");
      await expect(page.getByTestId(`fila-${sessaoId}`)).toContainText("Em atendimento", {
        timeout: ESPERA,
      });
      await page.getByTestId(`fila-${sessaoId}`).click();
      await expect(page.getByTestId("painel-do-paciente").getByTestId("acao-chegou")).toHaveCount(
        0,
      );
    } finally {
      await admin.from("calendar_appointments").delete().eq("id", sessaoId);
      await admin.from("contacts").delete().eq("id", contactId);
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
