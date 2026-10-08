/**
 * AS VISÕES SEMANA E MÊS DA AGENDA NOVA (fork TOQ, módulo clínica).
 *
 * A agenda da interface nova mostrava um dia por vez; a da versão atual tem Dia, Semana e Mês.
 * Esta spec prova, pela tela, que a nova tem as três: a Semana desenha uma coluna por dia, com as
 * sessões que se sobrepõem lado a lado (sem uma cobrir a outra); o Mês mostra o calendário com as
 * sessões de cada dia; o dia do Mês abre o Dia; a sessão abre a folha; a visão escolhida fica.
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
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-agenda-semana-mes");

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

test.describe("Semana e Mês na agenda da interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a semana põe as sobrepostas lado a lado e o mês abre o dia", async ({ page, context }) => {
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
    const nomeDoTipo = `Fisioterapia semana ${sufixo}`;
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: nomeDoTipo,
        slug: `fisio-semana-${sufixo}`,
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

    const nomes = [`Bia Semana ${sufixo}`, `Caio Semana ${sufixo}`];
    const { data: contatos, error: erroContatos } = await admin
      .from("contacts")
      .insert(
        nomes.map((name, i) => ({
          organization_id: orgId,
          name,
          phone_number: `+55119${i}4${sufixo}`,
        })) as never,
      )
      .select("id, name");
    if (erroContatos || !contatos) throw new Error(`contacts insert: ${erroContatos?.message}`);
    const idDe = (nome: string) =>
      (contatos as { id: string; name: string }[]).find((c) => c.name === nome)!.id;

    // Duas sessões de hoje que se sobrepõem por 20 minutos, com profissionais diferentes ou não.
    const base = new Date(Date.now() - 90 * 60_000);
    base.setSeconds(0, 0);
    const sessoes = nomes.map((nome, i) => {
      const inicio = new Date(base.getTime() + i * 30 * 60_000);
      return {
        organization_id: orgId,
        title: nomeDoTipo,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 50 * 60_000).toISOString(),
        status: "confirmed",
        owner_user_id: userId,
        contact_id: idDe(nome),
        event_type_id: tipoId,
        created_by_kind: "system",
        source: "ui",
      };
    });
    const { data: criadas, error: erroSessoes } = await admin
      .from("calendar_appointments")
      .insert(sessoes as never)
      .select("id");
    if (erroSessoes || !criadas) {
      throw new Error(`calendar_appointments insert: ${erroSessoes?.message}`);
    }
    const ids = (criadas as { id: string }[]).map((s) => s.id);
    const desfazerFuso = await fusoDaOrganizacaoLongeDaVirada(admin, orgId, 120, 30);

    try {
      await page.goto("/hoje");
      await page.evaluate(() => {
        window.localStorage.setItem("novo:ver-como", "gestao");
        window.localStorage.removeItem("novo:agenda-visao");
      });
      await page.goto("/agenda");
      await expect(page.getByTestId("novo-visao-dia")).toHaveAttribute("aria-pressed", "true", {
        timeout: ESPERA,
      });

      // ── Semana ──
      await page.getByTestId("novo-visao-semana").click();
      const semana = page.getByTestId("novo-agenda-semana");
      await expect(semana).toBeVisible({ timeout: ESPERA });
      await expect(semana.getByTestId("novo-semana-dia")).toHaveCount(7);
      const blocoA = semana.getByTestId("novo-bloco").filter({ hasText: nomes[0]! });
      const blocoB = semana.getByTestId("novo-bloco").filter({ hasText: nomes[1]! });
      await expect(blocoA).toBeVisible();
      await expect(blocoB).toBeVisible();
      const a = (await blocoA.boundingBox())!;
      const b = (await blocoB.boundingBox())!;
      // Lado a lado: um termina antes de o outro começar, na horizontal.
      expect(Math.min(a.x + a.width, b.x + b.width)).toBeLessThanOrEqual(Math.max(a.x, b.x));
      // A foto pega o cabeçalho dos dias e as duas sessões.
      const topoDasSessoes = Math.min(a.y, b.y);
      await page.evaluate((y) => window.scrollBy(0, y - 560), topoDasSessoes);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "1-semana.png") });

      await blocoB.click();
      const folha = page.getByTestId("novo-folha-sessao");
      await expect(folha).toContainText(nomes[1]!, { timeout: ESPERA });
      await folha.getByRole("button", { name: "Fechar" }).click();
      await expect(folha).toHaveCount(0, { timeout: ESPERA });

      // ── Mês ──, e a escolha fica depois de recarregar.
      await page.getByTestId("novo-visao-mes").click();
      await page.reload();
      const mes = page.getByTestId("novo-agenda-mes");
      await expect(mes).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("novo-visao-mes")).toHaveAttribute("aria-pressed", "true");
      const diaDeHoje = mes.getByTestId("novo-mes-dia").filter({ hasText: nomes[0]! });
      await expect(diaDeHoje).toHaveCount(1, { timeout: ESPERA });
      await expect(diaDeHoje).toContainText(nomes[1]!);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "2-mes.png") });

      // O dia do Mês abre o Dia daquele dia.
      await diaDeHoje.locator("button").first().click();
      await expect(page.getByTestId("novo-visao-dia")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("novo-bloco").filter({ hasText: nomes[0]! })).toBeVisible({
        timeout: ESPERA,
      });
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "3-dia-aberto-pelo-mes.png") });

      // Celular: o Mês cabe na largura, com a contagem de sessões em cada dia.
      await page.getByTestId("novo-visao-mes").click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(mes).toBeVisible({ timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await animacoesTerminadas(page);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-mes-no-celular.png") });
    } finally {
      await page
        .evaluate(() => {
          window.localStorage.removeItem("novo:ver-como");
          window.localStorage.removeItem("novo:agenda-visao");
        })
        .catch(() => {});
      await desfazerFuso();
      await admin.from("calendar_appointments").delete().in("id", ids);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
      for (const nome of nomes) await admin.from("contacts").delete().eq("id", idDe(nome));
    }
  });
});
