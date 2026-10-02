/**
 * O RESUMO NO TOPO DA FICHA DO PACIENTE (fork TOQ, módulo clínica).
 *
 * Com o módulo instalado, a ficha de um contato que tem sessões na agenda abre com
 * as modalidades, a equipe e três cartões: próxima sessão, reavaliação e últimos 60
 * dias. Um contato sem sessão nenhuma continua com a ficha de sempre.
 *
 * As sessões são semeadas pelo service role em instantes RELATIVOS (daqui a dois
 * dias, daqui a nove, três dias atrás), às 13h UTC. A spec não escolhe dia nem
 * horário na grade: ela lê a ficha, que mostra o que estiver marcado.
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
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-ficha-com-resumo");

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

/** Daqui a `dias` dias (negativo = no passado), às 13h UTC. */
function emDias(dias: number): Date {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

async function novoContato(orgId: string, nome: string): Promise<string> {
  const { data, error } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: nome, source: "manual" } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`contacts insert: ${error?.message}`);
  return (data as { id: string }).id;
}

test.describe("Ficha do paciente: resumo com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("abre pela próxima sessão, pela reavaliação e pelos últimos 60 dias", async ({
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
    const paciente = await novoContato(orgId, `Paciente do resumo ${sufixo}`);
    const semSessao = await novoContato(orgId, `Contato sem sessão ${sufixo}`);

    const sessoes = [
      { title: "Sessão de fisioterapia", dias: 2, minutos: 50, status: "pending" },
      { title: "Reavaliação", dias: 9, minutos: 45, status: "confirmed" },
      { title: "Aula de pilates", dias: -3, minutos: 55, status: "no_show" },
    ];
    const ids: string[] = [];
    try {
      for (const s of sessoes) {
        const comeca = emDias(s.dias);
        const { data, error } = await admin
          .from("calendar_appointments")
          .insert({
            organization_id: orgId,
            title: s.title,
            starts_at: comeca.toISOString(),
            ends_at: new Date(comeca.getTime() + s.minutos * 60 * 1000).toISOString(),
            status: s.status,
            owner_user_id: userId,
            contact_id: paciente,
            created_by_kind: "system",
            source: "ui",
          } as never)
          .select("id")
          .single();
        if (error || !data) throw new Error(`calendar_appointments insert: ${error?.message}`);
        ids.push((data as { id: string }).id);
      }

      await page.goto(`/app/contacts/${paciente}`);
      const resumo = page.getByTestId("resumo-do-paciente");
      await expect(resumo).toBeVisible({ timeout: ESPERA });

      const proxima = page.getByTestId("cartao-proxima-sessao");
      await expect(proxima).toContainText("Sessão de fisioterapia");
      await expect(proxima).toContainText("Aguardando confirmação");
      await expect(proxima.getByRole("link")).toHaveAttribute("href", /compromisso=/);

      await expect(page.getByTestId("cartao-reavaliacao")).not.toContainText("Ainda não marcada");
      await expect(page.getByTestId("cartao-ultimos-dias")).toContainText("1 falta");

      await expect(page.getByTestId("modalidade-do-paciente-fisioterapia")).toBeVisible();
      await expect(page.getByTestId("modalidade-do-paciente-pilates")).toBeVisible();
      await expect(page.getByTestId("equipe-do-paciente")).toBeVisible();
      await resumo.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-resumo.png") });

      // Contato sem sessão: a ficha de sempre, sem resumo.
      await page.goto(`/app/contacts/${semSessao}`);
      await expect(page.getByRole("tab", { name: "Visão geral" })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(page.getByTestId("resumo-do-paciente")).toHaveCount(0);
    } finally {
      if (ids.length > 0) await admin.from("calendar_appointments").delete().in("id", ids);
      await admin.from("contacts").delete().in("id", [paciente, semSessao]);
    }
  });
});
