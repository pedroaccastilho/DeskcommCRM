/**
 * "OFERECER RENOVAÇÃO" NO BALCÃO DA RECEPÇÃO (fork TOQ, módulo clínica).
 *
 * O Balcão lista os pacotes perto do fim (saldo no limite "Avisar a renovação quando restarem"
 * das Regras da clínica, 2 no padrão), e cada linha leva à ficha do paciente, onde fica o
 * "Vender pacote". Um pacote com saldo folgado não entra na lista.
 *
 * Os pacotes e as sessões gastas entram direto no banco: a venda pela tela e o consumo pela
 * agenda já são provados em `clinica-pacotes-na-ficha` e nos invariantes do backend.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const DIA = 86_400_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/visual-pacotes-renovar");

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

test.describe("Balcão: oferecer renovação dos pacotes perto do fim", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("lista quem está perto do fim e leva à ficha para vender o próximo", async ({
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

    const orgId = await orgDoUsuario(await idDoUsuario(creds.users.agent!.email));
    const sufixo = Date.now().toString(36);
    const nomePerto = `Paciente perto do fim ${sufixo}`;
    const nomeFolgado = `Paciente com saldo ${sufixo}`;

    async function pacienteComPacote(nome: string, usadas: number): Promise<string> {
      const { data: contato, error: erroContato } = await admin
        .from("contacts")
        .insert({ organization_id: orgId, name: nome, source: "manual" } as never)
        .select("id")
        .single();
      if (erroContato || !contato) throw new Error(`contacts insert: ${erroContato?.message}`);
      const contactId = (contato as { id: string }).id;
      const agora = Date.now();
      const { data: pacote, error: erroPacote } = await admin
        .from("clinica_pacotes")
        .insert({
          organization_id: orgId,
          contact_id: contactId,
          nome: "Fisioterapia 10 sessões",
          modalidade: "fisioterapia",
          sessoes_total: 10,
          comprado_em: new Date(agora - 30 * DIA).toISOString(),
          valido_ate: new Date(agora + 30 * DIA).toISOString(),
          aceite_politica_em: new Date(agora - 30 * DIA).toISOString(),
          aceite_multa_pct: 30,
          aceite_antecedencia_horas: 24,
        } as never)
        .select("id")
        .single();
      if (erroPacote || !pacote) throw new Error(`clinica_pacotes insert: ${erroPacote?.message}`);
      const { error: erroConsumo } = await admin.from("clinica_pacote_consumos").insert(
        Array.from({ length: usadas }, (_, i) => ({
          organization_id: orgId,
          pacote_id: (pacote as { id: string }).id,
          motivo: "realizada",
          sessao_em: new Date(agora - (i + 1) * DIA).toISOString(),
        })) as never,
      );
      if (erroConsumo) throw new Error(`clinica_pacote_consumos insert: ${erroConsumo.message}`);
      return contactId;
    }

    const perto = await pacienteComPacote(nomePerto, 9);
    const folgado = await pacienteComPacote(nomeFolgado, 3);

    try {
      await context.clearCookies();
      await login(page, creds.users.agent!.email, creds.password);
      await page.goto("/app/clinica/balcao");
      const lista = page.getByTestId("pacotes-para-renovar");
      await expect(lista).toBeVisible({ timeout: ESPERA });
      const linha = lista.getByTestId("pacote-para-renovar").filter({ hasText: nomePerto });
      await expect(linha).toContainText("resta 1 de 10 sessões");
      await expect(lista.getByText(nomeFolgado)).toHaveCount(0);
      await lista.scrollIntoViewIfNeeded();
      fs.mkdirSync(EVIDENCIA, { recursive: true });
      await page.screenshot({ path: path.join(EVIDENCIA, "e2e-balcao.png") });

      await linha.click();
      await page.waitForURL(new RegExp(`/app/contacts/${perto}`), { timeout: ESPERA });
      const valendo = page.getByTestId("pacote-valendo");
      await expect(valendo.getByTestId("hora-de-renovar")).toBeVisible({ timeout: ESPERA });
      await expect(
        page.getByTestId("pacotes-do-paciente").getByRole("button", { name: "Vender pacote" }),
      ).toBeVisible();
    } finally {
      await admin.from("clinica_pacotes").delete().in("contact_id", [perto, folgado]);
      await admin.from("contacts").delete().in("id", [perto, folgado]);
    }
  });
});
