/**
 * SESSÃO DA CLÍNICA NO PAINEL DO COMPROMISSO (fork TOQ, módulo clínica).
 *
 * Com o módulo instalado e o tipo de atendimento etiquetado com uma modalidade, o
 * painel que abre pela Agenda avisa a multa ANTES de cancelar em cima da hora,
 * mostra a multa que o cancelamento gerou (com o botão de isentar) e trava o
 * "Faltou" enquanto a tolerância de atraso não acabou.
 *
 * O painel abre direto por `?compromisso=`, o mesmo link do Histórico e da ficha do
 * paciente: a spec não escolhe dia nem bloco na grade, então a semana desenhada
 * não importa. Os horários são relativos ao relógio porque a regra É relativa a
 * ele: uma sessão daqui a 3 horas está dentro das 24h da multa, e uma que começou
 * há 5 minutos está dentro dos 15 de tolerância.
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
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-cancelar-com-multa");

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

test.describe("Agenda: sessão da clínica no painel do compromisso", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("avisa a multa antes de cancelar, mostra e isenta a multa, e trava a falta na tolerância", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
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

    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Sessão de fisioterapia ${sufixo}`,
        slug: `sessao-fisio-${sufixo}`,
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
        name: `Paciente da multa ${sufixo}`,
        source: "manual",
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const pacienteId = (contato as { id: string }).id;

    async function semear(titulo: string, comeca: Date): Promise<string> {
      const { data, error } = await admin
        .from("calendar_appointments")
        .insert({
          organization_id: orgId,
          title: titulo,
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
    const emCimaDaHora = await semear("Fisioterapia", new Date(Date.now() + 3 * 60 * MINUTO));
    const comecouAgora = await semear("Fisioterapia", new Date(Date.now() - 5 * MINUTO));

    try {
      // 1. Cancelar em cima da hora: o aviso vem antes, a multa aparece depois.
      await page.goto(`/app/agenda?compromisso=${emCimaDaHora}`);
      const aviso = page.getByTestId("aviso-de-multa");
      await expect(aviso).toBeVisible({ timeout: ESPERA });
      await expect(aviso).toContainText("30%");

      // Marcar "a clínica desmarcou" tira o aviso; desmarcar devolve.
      const pelaClinica = page.getByTestId("cancelado-pela-clinica");
      await pelaClinica.check();
      await expect(aviso).toBeHidden();
      await pelaClinica.uncheck();
      await expect(aviso).toBeVisible();

      await page.getByLabel("Motivo do cancelamento").fill("Paciente avisou que está doente");
      await aviso.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-aviso.png") });
      await page.getByRole("button", { name: "Cancelar agendamento" }).click();

      const multa = page.getByTestId("multa-da-sessao");
      await expect(multa).toBeVisible({ timeout: ESPERA });
      await expect(multa).toContainText("Multa pendente");
      await expect(page.getByTestId("valor-da-multa")).toContainText("45,00");
      await multa.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-multa.png") });

      await page.getByTestId("isentar-multa").click();
      await page.getByTestId("motivo-da-isencao").fill("Atestado médico apresentado");
      await multa.getByRole("button", { name: "Isentar multa" }).click();
      await expect(multa).toContainText("Multa isenta", { timeout: ESPERA });

      // 2. Começou há 5 minutos: dentro da tolerância, o "Faltou" fica travado.
      await page.goto(`/app/agenda?compromisso=${comecouAgora}`);
      await expect(page.getByTestId("aviso-de-tolerancia")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByRole("button", { name: "Faltou" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Compareceu" })).toBeEnabled();
      await page.getByTestId("aviso-de-tolerancia").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-tolerancia.png") });
    } finally {
      await admin.from("clinica_multas").delete().eq("contact_id", pacienteId);
      await admin.from("calendar_appointments").delete().in("id", [emCimaDaHora, comecouAgora]);
      await admin.from("contacts").delete().eq("id", pacienteId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
