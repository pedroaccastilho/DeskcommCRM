/**
 * AGENDA PINTADA PELA MODALIDADE (fork TOQ, módulo clínica).
 *
 * Com o módulo instalado, a grade troca a cor de PESSOA pela de MODALIDADE, e quem
 * atende passa a aparecer pela inicial no bloco. O alternador "Cores" volta à cor
 * de pessoa, que é o comportamento do núcleo.
 *
 * A sessão é semeada pelo service role para daqui a dois dias, às 13h UTC, sem tipo
 * de atendimento: a modalidade sai do título ("Aula de pilates"), o mesmo caminho de
 * um compromisso marcado antes do cadastro do tipo. A grade chega à semana dela por
 * `irParaASemanaDoCompromisso`, que lê o dia no fuso do navegador.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { irParaASemanaDoCompromisso } from "./helpers/agenda-semana-integra";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-cor-por-modalidade");

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

/** Daqui a dois dias, 13h UTC: dentro do horário que a grade desenha em qualquer fuso do Brasil. */
function daquiADoisDias(): Date {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

test.describe("Agenda: cores por modalidade com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("pinta pela modalidade, mostra quem atende e volta à cor de pessoa", async ({
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

    const comeca = daquiADoisDias();
    const { data: sessao, error } = await admin
      .from("calendar_appointments")
      .insert({
        organization_id: orgId,
        title: "Aula de pilates",
        starts_at: comeca.toISOString(),
        ends_at: new Date(comeca.getTime() + 55 * 60 * 1000).toISOString(),
        status: "confirmed",
        owner_user_id: userId,
        created_by_kind: "system",
        source: "ui",
      } as never)
      .select("id")
      .single();
    if (error || !sessao) throw new Error(`calendar_appointments insert: ${error?.message}`);
    const id = (sessao as { id: string }).id;

    try {
      await page.goto("/app/agenda");
      await irParaASemanaDoCompromisso(page, comeca.toISOString());
      const bloco = page.getByTestId(`agendamento-${id}`);
      await expect(bloco).toBeVisible({ timeout: ESPERA });
      await page.getByTestId("cores-modalidade").click();

      await expect(page.getByTestId("legenda-das-modalidades")).toBeVisible();
      await expect(page.getByTestId(`faixa-${id}`)).toHaveAttribute(
        "style",
        /--agenda-modalidade-pilates/,
      );
      await expect(page.getByTestId(`inicial-${id}`)).toBeVisible();
      await bloco.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-modalidade.png") });

      await page.getByTestId("cores-profissional").click();
      await expect(page.getByTestId(`faixa-${id}`)).toHaveAttribute("style", /--agenda-pessoa-/);
      await expect(page.getByTestId(`inicial-${id}`)).toHaveCount(0);
      await expect(page.getByTestId("legenda-das-modalidades")).toHaveCount(0);

      // A escolha é de quem olha e sobrevive ao recarregar.
      await page.reload();
      await irParaASemanaDoCompromisso(page, comeca.toISOString());
      await expect(page.getByTestId("cores-profissional")).toHaveAttribute("aria-pressed", "true", {
        timeout: ESPERA,
      });
    } finally {
      await admin.from("calendar_appointments").delete().eq("id", id);
    }
  });
});
