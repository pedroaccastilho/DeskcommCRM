/**
 * O BALCÃO DA RECEPÇÃO (fork TOQ, módulo clínica).
 *
 * Com o módulo instalado, o menu ganha "Balcão": a fila do dia ao lado do paciente escolhido,
 * com uma ação principal por horário e as janelas rápidas (cancelar com a multa já calculada,
 * remarcar, WhatsApp). A spec prova pela tela o que a recepção faz o dia todo:
 *
 *   - confirmar a presença de quem não confirmou;
 *   - registrar a falta de quem passou da tolerância, e NÃO deixar registrar antes dela;
 *   - cancelar em cima da hora vendo a multa de 30% antes do clique, e a multa aparecer no painel.
 *
 * As sessões são semeadas pelo service role em instantes RELATIVOS ao agora (de 25 minutos atrás
 * a duas horas à frente), para caírem no dia de hoje. Perto da meia-noite do fuso da organização
 * alguma pode cair no dia seguinte; a CI roda de dia no fuso de São Paulo.
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
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-balcao");

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

async function novoContato(orgId: string, nome: string, telefone: string): Promise<string> {
  const { data, error } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: nome, phone_number: telefone, source: "manual" } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`contacts insert: ${error?.message}`);
  return (data as { id: string }).id;
}

test.describe("Balcão da recepção com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("confirma, registra a falta depois da tolerância e cancela vendo a multa", async ({
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
    const orgId = await orgDoUsuario(userId);
    const sufixo = Date.now().toString(36);

    // Um tipo de fisioterapia com preço: é ele que liga a tolerância e a multa.
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Sessão de fisioterapia balcão ${sufixo}`,
        slug: `sessao-fisio-balcao-${sufixo}`,
        default_price_cents: 15000,
      } as never)
      .select("id")
      .single();
    if (erroTipo || !tipo) throw new Error(`calendar_event_types insert: ${erroTipo?.message}`);
    const tipoId = (tipo as { id: string }).id;
    const { error: erroEtiqueta } = await admin
      .from("clinica_tipos_atendimento")
      .insert({ organization_id: orgId, event_type_id: tipoId, modalidade: "fisioterapia" } as never);
    if (erroEtiqueta) throw new Error(`clinica_tipos_atendimento insert: ${erroEtiqueta.message}`);

    const contatos: string[] = [];
    const ids: Record<string, string> = {};
    try {
      const pacientes = {
        semConfirmacao: { nome: `Ana Confirmar ${sufixo}`, minutos: 60, status: "pending" },
        passouDaTolerancia: { nome: `Bruno Faltou ${sufixo}`, minutos: -25, status: "confirmed" },
        dentroDaTolerancia: { nome: `Carla Atrasada ${sufixo}`, minutos: -5, status: "confirmed" },
      } as const;
      let n = 0;
      for (const [chave, p] of Object.entries(pacientes)) {
        n += 1;
        const contato = await novoContato(orgId, p.nome, `55119900${sufixo.slice(-2)}${n}0${n}`.slice(0, 13));
        contatos.push(contato);
        const comeca = new Date(Date.now() + p.minutos * 60_000);
        comeca.setSeconds(0, 0);
        const { data, error } = await admin
          .from("calendar_appointments")
          .insert({
            organization_id: orgId,
            title: `Sessão de fisioterapia balcão ${sufixo}`,
            starts_at: comeca.toISOString(),
            ends_at: new Date(comeca.getTime() + 50 * 60_000).toISOString(),
            status: p.status,
            owner_user_id: userId,
            contact_id: contato,
            event_type_id: tipoId,
            created_by_kind: "system",
            source: "ui",
          } as never)
          .select("id")
          .single();
        if (error || !data) throw new Error(`calendar_appointments insert: ${error?.message}`);
        ids[chave] = (data as { id: string }).id;
      }

      // A porta: o menu, não a URL.
      await page.goto("/app");
      await page.getByRole("link", { name: "Balcão" }).first().click();
      await page.waitForURL(/\/app\/clinica\/balcao/, { timeout: ESPERA });
      await expect(page.getByRole("heading", { name: "Balcão" })).toBeVisible();
      await expect(page.getByTestId(`fila-${ids.semConfirmacao}`)).toBeVisible({ timeout: ESPERA });
      await page.screenshot({ path: path.join(EVIDENCIA, "balcao.png"), fullPage: true });

      // Passou da tolerância: a ação principal é registrar a falta.
      await page.getByTestId(`fila-${ids.passouDaTolerancia}`).click();
      const painel = page.getByTestId("painel-do-paciente");
      await expect(painel).toContainText(pacientes.passouDaTolerancia.nome);
      const faltou = painel.getByTestId("acao-faltou");
      await expect(faltou).toBeEnabled();
      await faltou.click();
      await expect(page.getByText("Falta registrada.")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId(`fila-${ids.passouDaTolerancia}`)).toContainText("Faltou", {
        timeout: ESPERA,
      });

      // Dentro da tolerância: o painel diz a partir de quando, e a falta não está à mão.
      await page.getByTestId(`fila-${ids.dentroDaTolerancia}`).click();
      await expect(painel).toContainText(pacientes.dentroDaTolerancia.nome);
      await expect(painel.getByTestId("aviso-tolerancia")).toBeVisible();
      await expect(painel.getByTestId("acao-faltou")).toHaveCount(0);
      await page.screenshot({ path: path.join(EVIDENCIA, "dentro-da-tolerancia.png") });

      // Sem confirmação: confirmar é a ação principal.
      await page.getByTestId(`fila-${ids.semConfirmacao}`).click();
      await expect(painel).toContainText(pacientes.semConfirmacao.nome);
      await painel.getByTestId("acao-confirmar").click();
      await expect(page.getByText("Presença confirmada.")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId(`fila-${ids.semConfirmacao}`)).toContainText("Confirmado", {
        timeout: ESPERA,
      });

      // Cancelar em cima da hora: a multa aparece ANTES do clique.
      await painel.getByTestId("acao-cancelar").click();
      const janela = page.getByTestId("janela-cancelar");
      await expect(janela).toBeVisible();
      await expect(janela.getByTestId("previa-da-multa")).toContainText("30%");
      await expect(janela.getByTestId("previa-da-multa")).toContainText("45,00");
      await page.screenshot({ path: path.join(EVIDENCIA, "cancelar-com-multa.png") });
      await janela.getByTestId("motivo-do-cancelamento").fill("Avisou pelo WhatsApp que está doente");
      await janela.getByTestId("confirmar-cancelar").click();
      await expect(page.getByText(/Multa de R\$\s?45,00 lançada/)).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId(`fila-${ids.semConfirmacao}`)).toContainText("Cancelado", {
        timeout: ESPERA,
      });
      await page.getByTestId(`fila-${ids.semConfirmacao}`).click();
      await expect(painel.getByTestId("multa-em-aberto")).toContainText("45,00", { timeout: ESPERA });

      // A janela do WhatsApp abre com o lembrete pronto (a spec não envia: não há chip na CI).
      await page.getByTestId(`fila-${ids.dentroDaTolerancia}`).click();
      await painel.getByTestId("acao-whatsapp").click();
      await expect(page.getByTestId("texto-do-whatsapp")).toHaveValue(/Carla/);
      await page.screenshot({ path: path.join(EVIDENCIA, "whatsapp.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("janela-whatsapp")).toHaveCount(0);

      // Celular: a fila e o painel empilham, sem rolagem lateral.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByTestId("fila-do-dia")).toBeVisible({ timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "balcao-celular.png"), fullPage: true });
    } finally {
      const lista = Object.values(ids);
      if (lista.length > 0) {
        await admin.from("clinica_multas").delete().in("appointment_id", lista);
        await admin.from("calendar_appointments").delete().in("id", lista);
      }
      if (contatos.length > 0) await admin.from("contacts").delete().in("id", contatos);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
