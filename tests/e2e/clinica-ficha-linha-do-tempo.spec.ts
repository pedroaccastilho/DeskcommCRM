/**
 * LINHA DO TEMPO E LGPD NA FICHA DA INTERFACE NOVA (fork TOQ, módulo clínica).
 *
 * A ficha da versão atual tinha as abas "Timeline" (mensagens, tarefas e mudanças do contato) e
 * "LGPD" (anonimizar, só o Administrador). Esta spec prova, pela tela, que a ficha nova mostra a
 * linha do tempo e deixa o Administrador anonimizar, com o mesmo diálogo de duas etapas, e que o
 * contato sai anonimizado no banco.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-ficha-linha-do-tempo");

const env = carregarEnvLocal();
const URL_SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(URL_SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function orgDoAdmin(): Promise<string> {
  const email = lerCreds().users.admin!.email.toLowerCase();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const id = data.users.find((u) => u.email?.toLowerCase() === email)!.id;
  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", id)
    .limit(1)
    .single();
  return (vinculo as { organization_id: string }).organization_id;
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

test.describe("Linha do tempo e LGPD na ficha nova", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a linha do tempo aparece e o administrador anonimiza", async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    if (!destinoEhLocal(URL_SUPABASE)) {
      throw new Error(`RECUSADO: ${URL_SUPABASE} não é loopback.`);
    }
    await loginComoAdmin(page, lerCreds());

    // O contato nasce pela API, para a linha do tempo ter o que mostrar (a criação vira atividade).
    const sufixo = String(Date.now()).slice(-7);
    const nome = `Leo Linha ${sufixo}`;
    const criado = await page.request.post("/api/v1/contacts", {
      data: { name: nome, phone_number: `+5511933${sufixo}` },
    });
    expect(criado.status(), await criado.text()).toBeLessThan(300);
    const contactId = ((await criado.json()) as { data: { contact: { id: string } } }).data.contact
      .id;

    // E um negócio no funil: a criação vira a primeira atividade da linha do tempo.
    const { data: funil } = await admin
      .from("crm_pipelines")
      .select("id, organization_id, crm_stages(id, position, is_won, is_lost)")
      .eq("organization_id", await orgDoAdmin())
      .limit(1)
      .single();
    const etapas = (
      funil as { crm_stages: { id: string; position: number; is_won: boolean; is_lost: boolean }[] }
    ).crm_stages
      .filter((e) => !e.is_won && !e.is_lost)
      .sort((x, y) => x.position - y.position);
    const etapa = etapas[0]!;
    const lead = await page.request.post("/api/v1/leads", {
      data: {
        pipeline_id: (funil as { id: string }).id,
        stage_id: etapa.id,
        title: `Avaliação ${nome}`,
        contact_id: contactId,
      },
    });
    expect(lead.status(), await lead.text()).toBeLessThan(300);
    // Mudar de etapa é o que o funil registra como atividade.
    const criadoLead = ((await lead.json()) as { data: { id: string; updated_at: string } }).data;
    const movido = await page.request.post(`/api/v1/leads/${criadoLead.id}/move`, {
      data: {
        stage_id: etapas[1]!.id,
        position_in_stage: 1000,
        expected_updated_at: criadoLead.updated_at,
      },
    });
    expect(movido.status(), await movido.text()).toBeLessThan(300);

    await page.goto("/hoje");
    await page.evaluate(() => window.localStorage.setItem("novo:ver-como", "gestao"));
    await page.goto(`/pacientes/${contactId}`);
    await expect(page.getByRole("heading", { name: nome })).toBeVisible({ timeout: ESPERA });

    // Linha do tempo: fechada até pedir, e então com os eventos do contato.
    await expect(page.getByTestId("novo-linha-do-tempo")).toHaveCount(0);
    await page.getByTestId("novo-linha-do-tempo-mostrar").click();
    const linha = page.getByTestId("novo-linha-do-tempo");
    await expect(linha).toBeVisible({ timeout: ESPERA });
    await expect(linha.locator(".animate-pulse")).toHaveCount(0, { timeout: ESPERA });
    await expect(linha).not.toContainText("Nenhuma atividade registrada ainda.");
    await linha.scrollIntoViewIfNeeded();
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "1-linha-do-tempo.png") });

    // LGPD: o mesmo diálogo de duas etapas da versão atual.
    const lgpd = page.getByTestId("novo-lgpd-da-ficha");
    await lgpd.scrollIntoViewIfNeeded();
    await lgpd.getByTestId("novo-anonimizar").click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Anonimizar contato (LGPD)")).toBeVisible({ timeout: ESPERA });
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "2-dialogo-de-anonimizacao.png") });
    await dialogo
      .getByRole("textbox")
      .first()
      .fill("Pedido formal do titular por e-mail (teste e2e).");
    await dialogo.getByRole("button", { name: "Continuar" }).click();
    await dialogo.getByLabel("Confirmação").fill("ANONIMIZAR");
    await dialogo.getByRole("button", { name: "Anonimizar permanentemente" }).click();
    await expect(lgpd).toContainText("Este contato já foi anonimizado", { timeout: ESPERA });
    await expect(page.getByRole("heading", { name: /Cliente Anonimizado/ })).toBeVisible({
      timeout: ESPERA,
    });
    await animacoesTerminadas(page);
    await page.screenshot({ path: path.join(EVIDENCIA, "3-anonimizado.png") });

    const { data } = await admin
      .from("contacts")
      .select("is_anonymized, name, phone_number")
      .eq("id", contactId)
      .single();
    const lido = data as { is_anonymized: boolean; name: string; phone_number: string | null };
    expect(lido.is_anonymized).toBe(true);
    expect(lido.name).toMatch(/^Cliente Anonimizado/);
    expect(lido.phone_number ?? "").not.toContain(sufixo);

    await page.evaluate(() => window.localStorage.removeItem("novo:ver-como")).catch(() => {});
  });
});
