/**
 * ORIGEM DO PACIENTE (fork TOQ, módulo clínica, migration 9005).
 *
 * O administrador acha a lista de origens em Configurações › Regras da clínica, já preenchida
 * com a lista padrão (WhatsApp, Instagram, indicação, encaminhamento médico, outra), e acrescenta
 * uma origem nova pela tela. O contato que chegou pelo WhatsApp aparece como "WhatsApp" sem
 * ninguém registrar. A recepção registra a origem dos outros: encaminhamento pede o médico,
 * indicação pede quem indicou (e ninguém indica a si mesmo). O relatório do mês conta os novos
 * por origem e por médico, e quantos compraram pacote. "Somente leitura" lê a origem, mas não
 * registra nem vê o relatório.
 *
 * Esta spec prova as ROTAS, com a sessão do navegador; o campo de origem na ficha, no "Novo
 * contato" e a tela do relatório são dirigidos pela tela em `clinica-origem-na-tela.spec.ts`. O
 * que tem tela aqui (a lista de origens) é dirigido pela tela.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA = process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-origens");

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

/** Login por senha. O `viewer` do seed não tem MFA. */
async function entrar(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

type Origem = { id: string; nome: string; tipo: string; ativo: boolean };
type OrigemDoPaciente = {
  origem: { id: string; nome: string; tipo: string } | null;
  detalhe: string | null;
  indicado_por: { id: string; nome: string } | null;
  automatica: boolean;
};
type LinhaDoRelatorio = {
  origem_id: string | null;
  nome: string;
  novos: number;
  com_pacote: number;
  automaticos: number;
  pacotes_valor_cents: number;
  detalhes: Array<{ detalhe: string; novos: number; com_pacote: number }>;
};

test.describe("Origem do paciente", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("lista de origens pela tela, WhatsApp sozinho, registro da recepção e o relatório do mês", async ({
    page,
    context,
  }) => {
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

    await context.clearCookies();
    await loginComoAdmin(page, creds);
    const orgId = await orgDoUsuario(await idDoUsuario(creds.users.admin!.email));
    const sufixo = Date.now().toString(36);
    const nomeDaOrigem = `Panfleto ${sufixo}`;
    const medico = `Dr. Encaminhador ${sufixo}`;

    const novoContato = async (nome: string, source: string): Promise<string> => {
      const { data, error } = await admin
        .from("contacts")
        .insert({ organization_id: orgId, name: nome, display_name: nome, source } as never)
        .select("id")
        .single();
      if (error || !data) throw new Error(`contacts insert: ${error?.message}`);
      return (data as { id: string }).id;
    };
    const doWhatsApp = await novoContato(`Chegou pelo WhatsApp ${sufixo}`, "whatsapp");
    const encaminhada = await novoContato(`Encaminhada ${sufixo}`, "manual");
    const indicada = await novoContato(`Indicada ${sufixo}`, "manual");
    const quemIndicou = await novoContato(`Quem indicou ${sufixo}`, "manual");
    const contatos = [doWhatsApp, encaminhada, indicada, quemIndicou];

    try {
      // A lista: Configurações › Regras da clínica, já com as origens padrão.
      await page.goto("/app/settings/tenant/clinica/regras");
      const bloco = page.getByTestId("bloco-origens");
      await expect(bloco).toBeVisible({ timeout: ESPERA });
      await expect(bloco).toContainText("Em uso");
      for (const padrao of ["WhatsApp", "Instagram: influenciador", "Encaminhamento médico"]) {
        await expect(
          bloco.locator(`input[data-testid="origem-nome"][value="${padrao}"]`),
        ).toHaveCount(1, { timeout: ESPERA });
      }
      await bloco.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "origens-padrao.png") });

      // Origem nova pela tela.
      const nova = bloco.getByTestId("origem-nova");
      await expect(nova.getByTestId("salvar-origem")).toBeDisabled();
      await nova.getByTestId("origem-nome").fill(nomeDaOrigem);
      await nova.getByTestId("origem-tipo").selectOption("outro");
      const criou = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/clinica/origens") && r.request().method() === "POST",
      );
      await nova.getByTestId("salvar-origem").click();
      expect((await criou).status()).toBe(201);
      await expect(
        bloco.locator(`input[data-testid="origem-nome"][value="${nomeDaOrigem}"]`),
      ).toHaveCount(1, { timeout: ESPERA });
      await page.reload();
      await expect(
        page.locator(`input[data-testid="origem-nome"][value="${nomeDaOrigem}"]`),
      ).toHaveCount(1, { timeout: ESPERA });
      await page.getByTestId("bloco-origens").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "origem-nova.png") });

      const origens = (
        (await (await page.request.get("/api/v1/clinica/origens")).json()) as { data: Origem[] }
      ).data;
      const porTipo = (tipo: string) => origens.find((o) => o.tipo === tipo && o.ativo)!;

      // Quem chegou pelo WhatsApp já tem origem, sem ninguém registrar.
      const lerOrigem = async (id: string) =>
        (
          (await (await page.request.get(`/api/v1/clinica/pacientes/${id}/origem`)).json()) as {
            data: OrigemDoPaciente;
          }
        ).data;
      expect(await lerOrigem(doWhatsApp)).toMatchObject({
        automatica: true,
        origem: { nome: "WhatsApp", tipo: "whatsapp" },
      });
      expect(await lerOrigem(encaminhada)).toMatchObject({ automatica: false, origem: null });

      // Encaminhamento pede o médico.
      const registrar = (id: string, corpo: Record<string, unknown>) =>
        page.request.put(`/api/v1/clinica/pacientes/${id}/origem`, { data: corpo });
      const encaminhamento = porTipo("encaminhamento");
      const semMedico = await registrar(encaminhada, { origem_id: encaminhamento.id });
      expect(semMedico.status()).toBe(422);
      expect(await semMedico.text()).toContain("Informe qual médico encaminhou o paciente.");
      expect(
        (await registrar(encaminhada, { origem_id: encaminhamento.id, detalhe: medico })).status(),
      ).toBe(200);

      // Indicação pede quem indicou, e ninguém indica a si mesmo.
      const indicacao = porTipo("indicacao");
      expect(
        (
          await registrar(indicada, { origem_id: indicacao.id, indicado_por_contact_id: indicada })
        ).status(),
      ).toBe(422);
      expect(
        (
          await registrar(indicada, {
            origem_id: indicacao.id,
            indicado_por_contact_id: quemIndicou,
          })
        ).status(),
      ).toBe(200);
      expect(await lerOrigem(indicada)).toMatchObject({
        automatica: false,
        origem: { id: indicacao.id },
        indicado_por: { id: quemIndicou, nome: `Quem indicou ${sufixo}` },
      });

      // A encaminhada compra um pacote.
      const venda = await page.request.post("/api/v1/clinica/pacotes", {
        data: {
          contact_id: encaminhada,
          modalidade: "fisioterapia",
          valor_cents: 90000,
          aceite_politica: true,
        },
      });
      expect(venda.status()).toBe(201);

      // O relatório do mês: o médico aparece com quem trouxe e quem comprou.
      const resposta = await page.request.get("/api/v1/clinica/relatorios/origens");
      expect(resposta.status()).toBe(200);
      const relatorio = ((await resposta.json()) as { data: { origens: LinhaDoRelatorio[] } }).data;
      const linhaDe = (id: string) => relatorio.origens.find((l) => l.origem_id === id)!;
      const doMedico = linhaDe(encaminhamento.id).detalhes.find((d) => d.detalhe === medico);
      expect(doMedico).toMatchObject({ novos: 1, com_pacote: 1 });
      expect(linhaDe(porTipo("whatsapp").id).automaticos).toBeGreaterThanOrEqual(1);
      expect(linhaDe(indicacao.id).novos).toBeGreaterThanOrEqual(1);

      // "Somente leitura" lê a origem, mas não registra nem vê o relatório.
      await context.clearCookies();
      await entrar(page, creds.users.viewer!.email, creds.password);
      expect(
        (await page.request.get(`/api/v1/clinica/pacientes/${indicada}/origem`)).status(),
      ).toBe(200);
      expect(
        (await registrar(doWhatsApp, { origem_id: encaminhamento.id, detalhe: "x" })).status(),
      ).toBe(403);
      expect((await page.request.get("/api/v1/clinica/relatorios/origens")).status()).toBe(403);
    } finally {
      await admin.from("clinica_pacotes").delete().in("contact_id", contatos);
      await admin.from("clinica_pacientes_origem").delete().in("contact_id", contatos);
      await admin.from("contacts").delete().in("id", contatos);
      await admin
        .from("clinica_origens")
        .delete()
        .eq("organization_id", orgId)
        .eq("nome", nomeDaOrigem);
    }
  });
});
