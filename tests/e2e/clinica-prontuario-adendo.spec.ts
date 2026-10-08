/**
 * ANAMNESE E ADENDO NO PRONTUÁRIO DA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * Com a chave "A equipe usa só a interface nova", quem atende não tem mais a ficha da versão
 * atual, e era lá que estavam a anamnese e o "Adicionar adendo" — o único jeito de corrigir um
 * registro assinado. Esta spec prova, pela tela, que a ficha nova faz os dois: o profissional
 * assina uma anamnese, abre o adendo no próprio registro, assina, e o adendo aparece logo abaixo,
 * ligado ao original. Confere no banco o tipo, o vínculo e que o original não mudou.
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
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-prontuario-adendo");

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

test.describe("Anamnese e adendo na ficha da interface nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("assina a anamnese e corrige com um adendo", async ({ page, context }) => {
    test.setTimeout(150_000);
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

    const sufixo = String(Date.now()).slice(-7);
    const nome = `Rui Adendo ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nome, phone_number: `+5511977${sufixo}` } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    try {
      // A tela de quem atende.
      await page.goto("/hoje");
      await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "saude"));
      await page.goto(`/pacientes/${contactId}`);
      await expect(page.getByRole("heading", { name: nome })).toBeVisible({ timeout: ESPERA });

      // Anamnese: a folha passa a oferecer o tipo, com os campos do conselho.
      await page.getByRole("button", { name: "Escrever evolução" }).click();
      const folha = page.getByTestId("novo-folha-evolucao");
      await expect(folha).toBeVisible({ timeout: ESPERA });
      await folha.getByRole("button", { name: "Anamnese", exact: true }).click();
      await expect(folha.getByRole("heading", { name: /^Anamnese de Rui/ })).toBeVisible();
      await folha.getByLabel("Queixa principal").fill("Dor lombar ao sentar");
      await folha.getByLabel("Diagnóstico fisioterapêutico").fill("Lombalgia mecânica");
      await folha.getByLabel("Prognóstico").fill("Bom");
      await folha.getByLabel("Objetivos do tratamento").fill("Sentar 1 hora sem dor");
      await folha.getByRole("button", { name: "Assinar anamnese" }).click();
      await expect(page.getByText(`Anamnese assinada no prontuário de Rui.`)).toBeVisible({
        timeout: ESPERA,
      });

      const prontuario = page.getByTestId("novo-prontuario");
      const original = prontuario.locator("article").filter({ hasText: "Lombalgia mecânica" });
      await expect(original).toBeVisible({ timeout: ESPERA });
      await page.screenshot({ path: path.join(EVIDENCIA, "1-anamnese-assinada.png") });

      // O registro assinado não se edita: a correção é um adendo, aberto no próprio registro.
      await original.getByTestId("novo-adicionar-adendo").click();
      await expect(folha).toBeVisible({ timeout: ESPERA });
      await expect(folha.getByTestId("novo-adendo-de")).toContainText("Adendo a anamnese");
      await expect(folha.getByRole("button", { name: "Evolução", exact: true })).toHaveCount(0);
      const assinarAdendo = folha.getByRole("button", { name: "Assinar o adendo" });
      await expect(assinarAdendo).toBeDisabled();
      await folha.getByTestId("novo-texto-do-registro").fill("Corrigindo: a dor é ao ficar de pé.");
      await page.screenshot({ path: path.join(EVIDENCIA, "2-adendo-escrito.png") });
      await assinarAdendo.click();
      await expect(page.getByText("Adendo assinado no prontuário de Rui.")).toBeVisible({
        timeout: ESPERA,
      });

      const adendo = prontuario.locator("article").filter({ hasText: "Corrigindo: a dor" });
      await expect(adendo).toBeVisible({ timeout: ESPERA });
      await expect(adendo).toContainText("Adendo a um registro anterior");
      // Adendo não recebe adendo.
      await expect(adendo.getByTestId("novo-adicionar-adendo")).toHaveCount(0);
      await adendo.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCIA, "3-adendo-no-prontuario.png") });

      const { data: registros } = await admin
        .from("prontuario_registros")
        .select("id, tipo, adendo_de, conteudo, texto")
        .eq("contact_id", contactId)
        .order("assinado_em");
      expect(registros).toHaveLength(2);
      const [anamnese, correcao] = registros as {
        id: string;
        tipo: string;
        adendo_de: string | null;
        conteudo: Record<string, unknown>;
        texto: string | null;
      }[];
      expect(anamnese!.tipo).toBe("anamnese");
      expect(anamnese!.conteudo).toMatchObject({
        queixa: "Dor lombar ao sentar",
        diagnostico_fisioterapeutico: "Lombalgia mecânica",
      });
      expect(correcao!.tipo).toBe("adendo");
      expect(correcao!.adendo_de).toBe(anamnese!.id);
      expect(correcao!.texto).toBe("Corrigindo: a dor é ao ficar de pé.");

      // Celular, sem rolagem lateral.
      await page.setViewportSize({ width: 390, height: 844 });
      await adendo.scrollIntoViewIfNeeded();
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "4-celular.png") });
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
      // O contato fica: o prontuário assinado não se apaga.
    }
  });
});
