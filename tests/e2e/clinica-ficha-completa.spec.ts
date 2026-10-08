/**
 * OS ITENS MENORES DA FICHA E DO HOJE NA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * A conferência do layout antigo contra o novo (08/10/2026) achou o que ainda só existia na
 * versão atual. Esta spec prova, pela tela, que a interface nova faz cada um:
 *   - a Observação ao agendar ("o que a equipe precisa lembrar neste horário"), gravada e
 *     mostrada na folha da sessão;
 *   - o botão de WhatsApp na ficha;
 *   - o aviso de contato bloqueado, com o "Desbloquear" do Administrador;
 *   - o filtro do prontuário por modalidade;
 *   - todas as evoluções pendentes no Hoje de quem atende, não só as seis primeiras.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { fusoDaOrganizacaoLongeDaVirada } from "./helpers/virada-do-dia";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-ficha-completa");

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

/** Espera as transições terminarem antes da foto; as animações sem fim ficam de fora. */
async function animacoesTerminadas(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

test.describe("Ficha e Hoje completos na interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("observação, WhatsApp, desbloqueio, filtro do prontuário e todas as pendências", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
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
    // Para o filtro por modalidade, o mesmo profissional assina também pilates. Devolvido no fim.
    const { data: cadastro } = await admin
      .from("clinica_profissionais")
      .select("id, modalidades")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .single();
    const modalidadesAntes = (cadastro as { modalidades: string[] }).modalidades;
    const profissionalId = (cadastro as { id: string }).id;
    await admin
      .from("clinica_profissionais")
      .update({ modalidades: [...new Set([...modalidadesAntes, "fisioterapia", "pilates"])] })
      .eq("id", profissionalId);

    const { data: dispAntes } = await admin
      .from("attendant_availability")
      .select("organization_id, user_id, is_available, schedule")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    await admin.from("attendant_availability").upsert(
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

    const sufixo = String(Date.now()).slice(-7);
    const nomeDoTipo = `Fisioterapia ficha ${sufixo}`;
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: nomeDoTipo,
        slug: `fisio-ficha-${sufixo}`,
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

    const nome = `Ivo Ficha ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: nome,
        phone_number: `+5511955${sufixo}`,
        is_blocked: true,
        blocked_reason: "opt_out",
        blocked_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    const sessao = (inicio: Date, extra: Record<string, unknown>) => ({
      organization_id: orgId,
      title: nomeDoTipo,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 50 * 60_000).toISOString(),
      owner_user_id: userId,
      contact_id: contactId,
      event_type_id: tipoId,
      created_by_kind: "system",
      source: "ui",
      ...extra,
    });
    const daqui = new Date(Date.now() + 15 * 60_000);
    daqui.setSeconds(0, 0);
    // Sete sessões atendidas e sem evolução, nos últimos dias: o Hoje mostra seis e "Ver todas".
    const passadas = Array.from({ length: 7 }, (_, i) => {
      // Às 10h de Brasília, um por dia, de ontem para trás.
      const d = new Date(Date.now() - (i + 1) * 86_400_000);
      d.setUTCHours(13, 0, 0, 0);
      return sessao(d, { status: "completed" });
    });
    const { data: criadas, error: erroSessoes } = await admin
      .from("calendar_appointments")
      .insert([
        sessao(daqui, { status: "confirmed", description: "Trazer o exame de imagem" }),
        ...passadas,
      ] as never)
      .select("id");
    if (erroSessoes || !criadas) {
      throw new Error(`calendar_appointments insert: ${erroSessoes?.message}`);
    }
    const sessoesCriadas = (criadas as { id: string }[]).map((s) => s.id);
    const desfazerFuso = await fusoDaOrganizacaoLongeDaVirada(admin, orgId, 30, 120);

    try {
      // ── Gestão: ficha com o aviso de bloqueio, o WhatsApp e a observação no Hoje ──
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
      await page.goto(`/pacientes/${contactId}`);
      await expect(page.getByRole("heading", { name: nome })).toBeVisible({ timeout: ESPERA });
      const aviso = page.getByTestId("novo-paciente-bloqueado");
      await expect(aviso).toContainText("Este contato pediu para não receber mensagens");
      await expect(page.getByTestId("novo-paciente-whatsapp")).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "1-ficha-bloqueada.png") });

      await aviso.getByTestId("novo-desbloquear").click();
      await expect(aviso).toContainText("Desbloquear volta a permitir campanhas");
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-confirmar-desbloqueio.png") });
      await aviso.getByTestId("novo-confirmar-desbloqueio").click();
      await expect(page.getByText("Contato desbloqueado.")).toBeVisible({ timeout: ESPERA });
      await expect(aviso).toHaveCount(0);
      const { data: desbloqueado } = await admin
        .from("contacts")
        .select("is_blocked")
        .eq("id", contactId)
        .single();
      expect((desbloqueado as { is_blocked: boolean }).is_blocked).toBe(false);

      // O botão de WhatsApp abre a conversa do paciente na caixa nova.
      await page.getByTestId("novo-paciente-whatsapp").click();
      await page.waitForURL(/\/whatsapp\?id=/, { timeout: ESPERA });
      await page.screenshot({ path: path.join(EVIDENCIA, "3-whatsapp-pela-ficha.png") });

      await page.goto("/hoje");
      await page
        .getByTestId("novo-linha-sessao")
        .filter({ hasText: nome })
        .first()
        .getByText(nome)
        .click({ timeout: ESPERA });
      const folha = page.getByTestId("novo-folha-sessao");
      await expect(folha.getByTestId("novo-observacao-da-sessao")).toContainText(
        "Trazer o exame de imagem",
        { timeout: ESPERA },
      );
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-observacao-na-folha.png") });
      await page.keyboard.press("Escape");

      // ── Quem atende: agenda com observação, filtra o prontuário e vê todas as pendências ──
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "saude"));
      for (const [modalidade, conteudo] of [
        ["fisioterapia", { conduta: "Mobilização lombar" }],
        ["pilates", { exercicios: "Série de core no reformer" }],
      ] as const) {
        const r = await page.request.post("/api/v1/clinica/prontuario", {
          data: {
            contact_id: contactId,
            modalidade,
            tipo: "evolucao",
            appointment_id: null,
            adendo_de: null,
            conteudo,
            texto: null,
          },
        });
        expect(r.status(), await r.text()).toBeLessThan(300);
      }

      await page.goto(`/pacientes/${contactId}`);
      const prontuario = page.getByTestId("novo-prontuario");
      await expect(prontuario.locator("article")).toHaveCount(2, { timeout: ESPERA });
      const filtro = page.getByRole("group", { name: "Filtrar por modalidade" });
      await filtro.getByRole("button", { name: "Pilates" }).click();
      await expect(prontuario.locator("article")).toHaveCount(1);
      await expect(filtro.getByRole("button", { name: "Todas" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(prontuario).toContainText("Série de core no reformer");
      await expect(prontuario).not.toContainText("Mobilização lombar");
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "5-prontuario-filtrado.png") });
      await filtro.getByRole("button", { name: "Todas" }).click();
      await expect(prontuario.locator("article")).toHaveCount(2);

      await page.getByRole("button", { name: "+ Agendar" }).click();
      const agendar = page.getByTestId("novo-folha-agendar");
      await agendar.getByRole("button", { name: nomeDoTipo }).click();
      await agendar.locator("button[aria-pressed]:has(span.n-titulo)").nth(1).click();
      await agendar.locator("div.grid-cols-4 button").first().click({ timeout: ESPERA });
      await agendar.getByTestId("novo-observacao-do-agendamento").fill("Primeira vez no pilates");
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "6-agendar-com-observacao.png") });
      await agendar.getByRole("button", { name: /^Agendar Ivo/ }).click();
      await expect(agendar).toHaveCount(0, { timeout: ESPERA });
      const { data: marcadas } = await admin
        .from("calendar_appointments")
        .select("id, description")
        .eq("contact_id", contactId)
        .not("id", "in", `(${sessoesCriadas.join(",")})`);
      expect(marcadas).toHaveLength(1);
      sessoesCriadas.push((marcadas![0] as { id: string }).id);
      expect((marcadas![0] as { description: string | null }).description).toBe(
        "Primeira vez no pilates",
      );

      // Todas as evoluções pendentes, não só as seis primeiras.
      await page.goto("/hoje");
      const pendencias = page.getByTestId("novo-pendencias");
      await expect(pendencias).toBeVisible({ timeout: ESPERA });
      const verTodas = page.getByTestId("novo-pendencias-ver-todas");
      await expect(verTodas).toBeVisible({ timeout: ESPERA });
      await expect(pendencias.locator("li")).toHaveCount(6);
      const total = Number((await verTodas.innerText()).match(/\((\d+)\)/)?.[1]);
      expect(total).toBeGreaterThanOrEqual(7);
      await verTodas.click();
      await expect(pendencias.locator("li")).toHaveCount(total);
      await expect(verTodas).toHaveText("Mostrar menos");
      await pendencias.scrollIntoViewIfNeeded();
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "7-todas-as-pendencias.png") });

      // Celular, sem rolagem lateral, na ficha.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/pacientes/${contactId}`);
      await expect(page.getByRole("heading", { name: nome })).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("novo-prontuario")).toBeVisible({ timeout: ESPERA });
      // Os botões descem para baixo do nome em vez de cobri-lo.
      const nomeNaTela = await page.getByRole("heading", { name: nome }).boundingBox();
      const botoes = await page.getByRole("button", { name: "Editar" }).boundingBox();
      expect(botoes!.y).toBeGreaterThanOrEqual(nomeNaTela!.y + nomeNaTela!.height);
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "8-celular.png") });
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      await desfazerFuso();
      // O prontuário assinado não se apaga, e o contato fica com ele; as sessões são encerradas
      // para não pesarem nas pendências e no Hoje das próximas rodadas.
      for (const id of sessoesCriadas) {
        const { error } = await admin.from("calendar_appointments").delete().eq("id", id);
        if (error) {
          await admin
            .from("calendar_appointments")
            .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
            .eq("id", id);
        }
      }
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
      await admin
        .from("clinica_profissionais")
        .update({ modalidades: modalidadesAntes })
        .eq("id", profissionalId);
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
