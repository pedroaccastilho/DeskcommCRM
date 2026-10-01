/**
 * PRONTUÁRIO PELA TELA: DA SESSÃO ATENDIDA À EVOLUÇÃO ASSINADA (fork TOQ, módulo clínica).
 *
 * O banco é o `baseline.sql` aplicado do zero, sem o módulo. O caminho, como na clínica:
 *   1. o dono do servidor instala "Clínica (prontuário)" em Módulos;
 *   2. o administrador da empresa se cadastra como profissional de saúde (fisioterapia);
 *   3. uma sessão de ontem, com paciente, aparece em "Evoluções pendentes";
 *   4. "Registrar evolução" abre a ficha do paciente na aba Prontuário, já vinculada à sessão;
 *   5. a evolução assinada aparece na linha do tempo com a assinatura carimbada pelo banco;
 *   6. a sessão sai das pendências.
 *
 * A sessão e o paciente são semeados pelo service role (marcar no passado não é caminho da
 * tela), com telefone único por rodada: registro assinado não se apaga, então a spec nunca
 * reaproveita o paciente de outra rodada.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `honorarios-instalar-e-pagar`.
 */
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-prontuario");

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

/** Paciente novo e uma sessão de ontem, atendida por `userId`. */
async function semearSessao(orgId: string, userId: string) {
  if (!destinoEhLocal(URL_SUPABASE)) {
    throw new Error(
      `RECUSADO: ${URL_SUPABASE} não é loopback — esta spec não escreve fora do local.`,
    );
  }
  const sufixo = String(Date.now()).slice(-8);
  const nome = `Paciente Prontuário ${sufixo}`;
  const { data: contato, error: e1 } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: nome, phone_number: `+55119${sufixo}` } as never)
    .select("id")
    .single();
  if (e1 || !contato) throw new Error(`contacts insert: ${e1?.message}`);
  const contactId = (contato as { id: string }).id;

  const comeca = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const termina = new Date(comeca.getTime() + 50 * 60 * 1000);
  const { data: sessao, error: e2 } = await admin
    .from("calendar_appointments")
    .insert({
      organization_id: orgId,
      title: "Sessão de fisioterapia",
      starts_at: comeca.toISOString(),
      ends_at: termina.toISOString(),
      status: "confirmed",
      owner_user_id: userId,
      contact_id: contactId,
      created_by_kind: "system",
      source: "ui",
    } as never)
    .select("id")
    .single();
  if (e2 || !sessao) throw new Error(`calendar_appointments insert: ${e2?.message}`);
  return { contactId, appointmentId: (sessao as { id: string }).id, nome };
}

test.describe("Prontuário: da sessão atendida à evolução assinada", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("instalar, cadastrar profissional, registrar a evolução pendente", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const creds = lerCreds();

    // 1. O dono do servidor instala o módulo.
    await loginComoDono(page, creds);
    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-clinica");
    await expect(cartao).toBeVisible({ timeout: ESPERA });
    const instalar = page.getByTestId("instalar-clinica");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i), "o módulo não ficou instalado").toBeVisible({
      timeout: ESPERA,
    });

    // 2. O administrador da empresa se cadastra como fisioterapeuta.
    await context.clearCookies();
    await loginComoAdmin(page, creds);
    const emailDoAdmin = creds.users.admin!.email;
    const userId = await idDoUsuario(emailDoAdmin);
    const orgId = await orgDoUsuario(userId);

    await page.goto("/app/settings/tenant/clinica");
    const jaCadastrado = (await (await page.request.get("/api/v1/clinica/eu")).json()) as {
      data: { profissional: unknown };
    };
    if (!jaCadastrado.data.profissional) {
      await page.getByTestId("profissional-usuario").selectOption(userId);
      await page.getByTestId("profissional-nome").fill("Ana Fisio E2E");
      await page.getByTestId("profissional-registro").fill("123456-F");
      await page.getByLabel("Fisioterapia", { exact: true }).check();
      await page.getByTestId("cadastrar-profissional").click();
      await expect(page.getByText("Ana Fisio E2E").first()).toBeVisible({ timeout: ESPERA });
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "1-profissionais.png"), fullPage: true });

    // 3. A sessão de ontem aparece nas pendências.
    const { contactId, appointmentId, nome } = await semearSessao(orgId, userId);
    await page.goto("/app/clinica/pendencias");
    const registrar = page.getByTestId(`registrar-evolucao-${appointmentId}`);
    await expect(registrar, "a sessão atendida não apareceu nas pendências").toBeVisible({
      timeout: ESPERA,
    });
    await expect(page.getByText(nome)).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "2-pendencias.png"), fullPage: true });

    // 4. O atalho abre a ficha na aba Prontuário, com a sessão vinculada.
    await registrar.click();
    await expect(page).toHaveURL(new RegExp(`/app/contacts/${contactId}\\?aba=prontuario`));
    await expect(page.getByTestId("registro-sessao")).toBeVisible({ timeout: ESPERA });

    // 5. Assinar a evolução.
    await page.getByLabel("Queixa principal").fill("Dor lombar ao sentar");
    await page.getByLabel("Dor (0 a 10)").fill("4");
    await page.getByTestId("registro-texto").fill("Boa resposta aos exercícios de estabilização.");
    await page.getByTestId("assinar-registro").click();
    const linha = page.getByTestId("prontuario-linha-do-tempo");
    await expect(linha).toContainText("Dor lombar ao sentar", { timeout: ESPERA });
    await expect(linha).toContainText("Ana Fisio E2E");
    await expect(linha).toContainText("CREFITO");
    await expect(linha).toContainText("Sessão da agenda");
    await page.screenshot({
      path: path.join(EVIDENCIA, "3-evolucao-assinada.png"),
      fullPage: true,
    });

    // 6. A sessão saiu das pendências.
    await page.goto("/app/clinica/pendencias");
    await expect(page.getByTestId(`registrar-evolucao-${appointmentId}`)).toHaveCount(0, {
      timeout: ESPERA,
    });

    // E o caminho da agenda resolve o paciente pela sessão.
    await page.goto(`/app/clinica/sessao/${appointmentId}`);
    await expect(page).toHaveURL(new RegExp(`/app/contacts/${contactId}\\?aba=prontuario`));
  });
});
