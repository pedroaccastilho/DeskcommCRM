/**
 * JANELAS RÁPIDAS DA SESSÃO NA AGENDA (fork TOQ, módulo clínica).
 *
 * O painel do compromisso que abre pela Agenda ganha as mesmas janelas do Balcão e do Meu dia:
 * remarcar, WhatsApp e marcar a próxima sessão, sem sair da Agenda. A spec abre o painel direto
 * por `?compromisso=`, remarca a sessão para um horário livre e marca a próxima, conferindo no
 * banco o que a tela fez.
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
const MINUTO = 60 * 1000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-agenda-janelas");

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

test.describe("Agenda: janelas rápidas da sessão da clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("remarca e marca a próxima sessão pelo painel do compromisso", async ({ page, context }) => {
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
    const orgId = await orgDoUsuario(userId);
    const sufixo = Date.now().toString(36);

    // Horários publicados todos os dias, para as janelas acharem horário livre. Guarda o que havia
    // e devolve no fim: outras specs usam o mesmo administrador.
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

    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Fisioterapia janelas ${sufixo}`,
        slug: `fisio-janelas-${sufixo}`,
        duration_minutes: 50,
        minimum_notice_minutes: 0,
        booking_window_days: 60,
        is_active: true,
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

    const nome = `Elisa Janelas ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: nome,
        phone_number: `+551197${String(Date.now()).slice(-7)}`,
        source: "manual",
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const pacienteId = (contato as { id: string }).id;

    // Daqui a dois dias, às 13h UTC (10h em São Paulo), dentro dos horários publicados.
    const comeca = new Date(Date.now() + 2 * 24 * 60 * MINUTO);
    comeca.setUTCHours(13, 0, 0, 0);
    const { data: sessao, error: erroSessao } = await admin
      .from("calendar_appointments")
      .insert({
        organization_id: orgId,
        title: `Fisioterapia janelas ${sufixo}`,
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
    if (erroSessao || !sessao)
      throw new Error(`calendar_appointments insert: ${erroSessao?.message}`);
    const sessaoId = (sessao as { id: string }).id;

    try {
      await page.goto(`/app/agenda?compromisso=${sessaoId}`);
      const acoes = page.getByTestId("acoes-da-sessao");
      await expect(acoes).toBeVisible({ timeout: ESPERA });
      await expect(acoes.getByTestId("agenda-whatsapp")).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "painel-com-janelas.png") });

      // WhatsApp abre por cima do painel e volta para ele.
      await acoes.getByTestId("agenda-whatsapp").click();
      await expect(page.getByTestId("janela-whatsapp")).toBeVisible({ timeout: ESPERA });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("janela-whatsapp")).toHaveCount(0, { timeout: ESPERA });

      // Remarcar para o primeiro horário livre de amanhã.
      await acoes.getByTestId("agenda-remarcar").click();
      const remarcar = page.getByTestId("janela-remarcar");
      await expect(remarcar).toBeVisible({ timeout: ESPERA });
      await remarcar.getByRole("button", { name: "Amanhã" }).click();
      const livres = remarcar.getByRole("group", { name: "Horários livres" });
      await expect(livres).toBeVisible({ timeout: ESPERA });
      await page.screenshot({ path: path.join(EVIDENCIA, "remarcar-pela-agenda.png") });
      await livres.getByRole("button").first().click();
      await remarcar.getByTestId("confirmar-remarcar").click();
      await expect(remarcar).toHaveCount(0, { timeout: ESPERA });
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("calendar_appointments")
              .select("starts_at")
              .eq("id", sessaoId)
              .single();
            return new Date((data as { starts_at: string }).starts_at).getTime();
          },
          { timeout: ESPERA },
        )
        .toBeLessThan(comeca.getTime());

      // Marcar a próxima, também sem sair do painel.
      await acoes.getByTestId("agenda-marcar-proxima").click();
      const proxima = page.getByTestId("janela-proxima-sessao");
      await expect(proxima).toBeVisible({ timeout: ESPERA });
      const livresDaProxima = proxima.getByRole("group", { name: "Horários livres" });
      await expect(livresDaProxima).toBeVisible({ timeout: ESPERA });
      await livresDaProxima.getByRole("button").first().click();
      await proxima.getByTestId("confirmar-proxima-sessao").click();
      await expect(proxima).toHaveCount(0, { timeout: ESPERA });
      await expect(page.getByTestId("acoes-da-sessao")).toBeVisible();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("calendar_appointments")
              .select("id")
              .eq("contact_id", pacienteId)
              .eq("owner_user_id", userId)
              .eq("event_type_id", tipoId);
            return data?.length ?? 0;
          },
          { timeout: ESPERA },
        )
        .toBe(2);
    } finally {
      await admin.from("calendar_appointments").delete().eq("contact_id", pacienteId);
      await admin.from("contacts").delete().eq("id", pacienteId);
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
