/**
 * MEU DIA DO PROFISSIONAL (fork TOQ, módulo clínica).
 *
 * O fisioterapeuta abre o Meu dia e encontra o paciente da vez em modo atendimento: o que foi
 * feito na última sessão à esquerda e a evolução de hoje à direita, já vinculada à sessão. A spec
 * prova pela tela o que ele faz entre um paciente e outro:
 *
 *   - marcar que o paciente compareceu;
 *   - repetir a conduta da última sessão com um toque e escolher a dor na escala de 0 a 10;
 *   - assinar a evolução sem sair da tela.
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
const EVIDENCIA = process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-meu-dia");

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

test.describe("Meu dia do profissional com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("o paciente da vez abre em modo atendimento e a evolução sai repetindo a conduta", async ({
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
    const { data: tipo, error: erroTipo } = await admin
      .from("calendar_event_types")
      .insert({
        organization_id: orgId,
        name: `Fisioterapia meu dia ${sufixo}`,
        slug: `fisio-meu-dia-${sufixo}`,
        default_price_cents: 15000,
      } as never)
      .select("id")
      .single();
    if (erroTipo || !tipo) throw new Error(`calendar_event_types insert: ${erroTipo?.message}`);
    const tipoId = (tipo as { id: string }).id;
    await admin
      .from("clinica_tipos_atendimento")
      .insert({
        organization_id: orgId,
        event_type_id: tipoId,
        modalidade: "fisioterapia",
      } as never);

    const nome = `Davi Atendido ${sufixo}`;
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({ organization_id: orgId, name: nome, phone_number: `+5511988${sufixo}` } as never)
      .select("id")
      .single();
    if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
    const contactId = (contato as { id: string }).id;

    const comeca = new Date(Date.now() - 5 * 60_000);
    comeca.setSeconds(0, 0);
    const { data: sessao, error: erroSessao } = await admin
      .from("calendar_appointments")
      .insert({
        organization_id: orgId,
        title: `Fisioterapia meu dia ${sufixo}`,
        starts_at: comeca.toISOString(),
        ends_at: new Date(comeca.getTime() + 50 * 60_000).toISOString(),
        status: "confirmed",
        owner_user_id: userId,
        contact_id: contactId,
        event_type_id: tipoId,
        created_by_kind: "system",
        source: "ui",
      } as never)
      .select("id")
      .single();
    if (erroSessao || !sessao)
      throw new Error(`calendar_appointments insert: ${erroSessao?.message}`);
    const sessaoId = (sessao as { id: string }).id;

    try {
      // A sessão anterior, assinada pelo próprio profissional pela API do prontuário.
      const anterior = await page.request.post("/api/v1/clinica/prontuario", {
        data: {
          contact_id: contactId,
          modalidade: "fisioterapia",
          tipo: "evolucao",
          appointment_id: null,
          adendo_de: null,
          conteudo: { dor: 6, conduta: "Fortalecimento de glúteo médio", plano: "Progredir carga" },
          texto: null,
        },
      });
      expect(anterior.status(), await anterior.text()).toBeLessThan(300);

      await page.goto("/app/clinica/meu-dia");
      await expect(page.getByRole("heading", { name: "Meu dia" })).toBeVisible({ timeout: ESPERA });
      await page.getByTestId(`horario-${sessaoId}`).click();
      const modo = page.getByTestId("modo-atendimento");
      await expect(modo).toContainText(nome, { timeout: ESPERA });
      await expect(modo.getByTestId("ultima-sessao")).toContainText(
        "Fortalecimento de glúteo médio",
        { timeout: ESPERA },
      );
      await expect(modo.getByTestId("registro-sessao")).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "modo-atendimento.png"), fullPage: true });

      // O paciente chegou.
      await modo.getByTestId("acao-compareceu").click();
      await expect(page.getByText("Presença registrada.")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId(`horario-${sessaoId}`)).toContainText("Compareceu", {
        timeout: ESPERA,
      });

      // Mesma conduta da última sessão, dor 3 na escala, e assina.
      await modo.getByTestId("repetir-conduta").click();
      await expect(modo.getByLabel("Conduta")).toHaveValue("Fortalecimento de glúteo médio");
      await expect(modo.getByLabel("Plano para a próxima sessão")).toHaveValue("Progredir carga");
      await modo
        .getByRole("radiogroup", { name: "Escolher de 0 a 10" })
        .getByRole("radio", { name: "3", exact: true })
        .click();
      await expect(modo.getByLabel("Dor (0 a 10)")).toHaveValue("3");
      await modo.getByLabel("Queixa principal").fill("Dor ao subir escada, melhorando");
      await page.screenshot({ path: path.join(EVIDENCIA, "evolucao-pronta.png"), fullPage: true });
      await modo.getByTestId("assinar-registro").click();
      await expect(page.getByText("Evolução assinada.")).toBeVisible({ timeout: ESPERA });
      await expect(modo.getByTestId("evolucao-assinada")).toBeVisible({ timeout: ESPERA });

      const { data: gravados } = await admin
        .from("prontuario_registros")
        .select("appointment_id, conteudo")
        .eq("contact_id", contactId)
        .eq("appointment_id", sessaoId);
      expect(gravados).toHaveLength(1);
      expect((gravados![0] as { conteudo: Record<string, unknown> }).conteudo).toMatchObject({
        dor: 3,
        conduta: "Fortalecimento de glúteo médio",
      });

      // Celular: lista e atendimento empilham sem rolagem lateral.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByTestId("meus-horarios")).toBeVisible({ timeout: ESPERA });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura).toBeLessThanOrEqual(390);
      await page.screenshot({ path: path.join(EVIDENCIA, "meu-dia-celular.png"), fullPage: true });
    } finally {
      await admin.from("calendar_appointments").delete().eq("id", sessaoId);
      await admin.from("clinica_tipos_atendimento").delete().eq("event_type_id", tipoId);
      await admin.from("calendar_event_types").delete().eq("id", tipoId);
    }
  });
});
