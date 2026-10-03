/**
 * ORIGEM DO PACIENTE PELA TELA (fork TOQ, módulo clínica, migration 9005).
 *
 * Como a recepção e a gerência fariam: a ficha de quem não tem origem pede o registro; a
 * recepção escolhe "Indicação de paciente", busca quem indicou e a ficha passa a mostrar
 * "Indicado por" com o link para a ficha de quem indicou. No "Novo contato", o encaminhamento
 * médico não passa sem o nome do médico. O relatório do período conta o médico por baixo da
 * origem e só abre para Gerente e Administrador. "Somente leitura" lê a origem e não muda.
 *
 * As rotas e a lista de origens são provadas em `clinica-origens.spec.ts`; aqui é a tela.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-origem-do-paciente");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function foto(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`) });
}

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

async function novoContato(orgId: string, nome: string): Promise<string> {
  const { data, error } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: nome, source: "manual" } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`contacts insert: ${error?.message}`);
  return (data as { id: string }).id;
}

test.describe("Origem do paciente: ficha, cadastro e relatório", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a recepção registra pela tela e a gerência lê o relatório", async ({ page, context }) => {
    test.setTimeout(240_000);
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

    const orgId = await orgDoUsuario(await idDoUsuario(creds.users.admin!.email));
    const sufixo = Date.now().toString(36);
    const nomeDeQuemIndicou = `Quem indicou ${sufixo}`;
    const nomeDoIndicado = `Indicado ${sufixo}`;
    const nomeDoEncaminhado = `Encaminhado ${sufixo}`;
    const medico = `Dr. Teste ${sufixo}`;
    const indicouId = await novoContato(orgId, nomeDeQuemIndicou);
    const indicadoId = await novoContato(orgId, nomeDoIndicado);
    const criados = [indicouId, indicadoId];

    try {
      // 1. Recepção: a ficha sem origem pede o registro; indicação pede quem indicou.
      await context.clearCookies();
      await login(page, creds.users.agent!.email, creds.password);
      await page.goto(`/app/contacts/${indicadoId}`);
      const linha = page.getByTestId("origem-do-paciente");
      await expect(linha).toContainText("Sem origem registrada.", { timeout: ESPERA });
      await linha.getByRole("button", { name: "Registrar origem" }).click();

      const dialogo = page.getByRole("dialog");
      await dialogo
        .getByLabel("Como chegou à clínica")
        .selectOption({ label: "Indicação de paciente" });
      await dialogo.getByRole("button", { name: "Salvar origem" }).click();
      await expect(dialogo.getByRole("alert")).toHaveText("Informe qual paciente fez a indicação.");

      await dialogo.getByLabel("Quem indicou").fill(nomeDeQuemIndicou);
      const opcao = dialogo.getByTestId("opcao-quem-indicou").filter({ hasText: nomeDeQuemIndicou });
      await expect(opcao).toBeVisible({ timeout: ESPERA });
      await foto(page, "e2e-quem-indicou");
      await opcao.click();
      await expect(dialogo.getByTestId("quem-indicou-escolhido")).toContainText(nomeDeQuemIndicou);
      await dialogo.getByRole("button", { name: "Salvar origem" }).click();
      await expect(dialogo).toBeHidden({ timeout: ESPERA });

      await expect(linha.getByTestId("origem-texto")).toContainText("Indicação de paciente");
      const indicadoPor = linha.getByTestId("indicado-por");
      await expect(indicadoPor).toContainText(nomeDeQuemIndicou);
      await expect(indicadoPor.getByRole("link")).toHaveAttribute(
        "href",
        `/app/contacts/${indicouId}`,
      );
      await foto(page, "e2e-indicado-por");

      // 2. Novo contato com encaminhamento: sem o médico, não cria.
      await page.goto("/app/contacts");
      await page.getByRole("button", { name: "Novo contato" }).click();
      const novo = page.getByRole("dialog");
      await novo.getByLabel("Nome").fill(nomeDoEncaminhado);
      await novo.getByLabel("Email").fill(`encaminhado-${sufixo}@exemplo.com`);
      await novo
        .getByLabel("Como chegou à clínica (opcional)")
        .selectOption({ label: "Encaminhamento médico" });
      await novo.getByRole("button", { name: "Criar contato" }).click();
      await expect(novo.getByText("Informe qual médico encaminhou o paciente.")).toBeVisible();
      await novo.getByLabel("Qual médico encaminhou?").fill(medico);
      await novo.getByRole("button", { name: "Criar contato" }).click();
      await expect(novo).toBeHidden({ timeout: ESPERA });

      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("contacts")
              .select("id")
              .eq("organization_id", orgId)
              .eq("name", nomeDoEncaminhado)
              .maybeSingle();
            return (data as { id: string } | null)?.id ?? null;
          },
          { timeout: ESPERA },
        )
        .not.toBeNull();
      const { data: encaminhado } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", nomeDoEncaminhado)
        .single();
      const encaminhadoId = (encaminhado as { id: string }).id;
      criados.push(encaminhadoId);
      await page.goto(`/app/contacts/${encaminhadoId}`);
      await expect(page.getByTestId("origem-texto")).toContainText(
        `Encaminhamento médico, ${medico}.`,
        { timeout: ESPERA },
      );

      // 3. O relatório é da gerência.
      await page.goto("/app/clinica/origens");
      await expect(page).toHaveURL(/\/403/, { timeout: ESPERA });

      // 4. Gerência: o médico aparece por baixo do encaminhamento.
      await context.clearCookies();
      await loginComoAdmin(page, creds);
      await page.goto("/app/clinica/origens");
      await expect(page.getByRole("heading", { name: "Origem dos pacientes" })).toBeVisible({
        timeout: ESPERA,
      });
      const doMedico = page.locator(`[data-testid="linha-do-detalhe"][data-detalhe="${medico}"]`);
      await expect(doMedico).toBeVisible({ timeout: ESPERA });
      await expect(doMedico).toContainText("1");
      await expect(
        page.locator('[data-testid="linha-da-origem"][data-origem="Indicação de paciente"]'),
      ).toBeVisible();
      await page.getByRole("button", { name: "Mês passado" }).click();
      await expect(page.getByRole("button", { name: "Mês passado" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(doMedico).toHaveCount(0, { timeout: ESPERA });
      await page.getByRole("button", { name: "Este mês" }).click();
      await expect(doMedico).toBeVisible({ timeout: ESPERA });
      await foto(page, "e2e-relatorio");

      // 5. Somente leitura: lê a origem, não muda.
      await context.clearCookies();
      await login(page, creds.users.viewer!.email, creds.password);
      await page.goto(`/app/contacts/${indicadoId}`);
      await expect(page.getByTestId("indicado-por")).toContainText(nomeDeQuemIndicou, {
        timeout: ESPERA,
      });
      await expect(
        page.getByTestId("origem-do-paciente").getByRole("button"),
      ).toHaveCount(0);
    } finally {
      await admin.from("clinica_pacientes_origem").delete().in("contact_id", criados);
      await admin.from("contacts").delete().in("id", criados);
    }
  });
});
