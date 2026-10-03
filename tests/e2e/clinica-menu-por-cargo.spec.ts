/**
 * MENU PRONTO POR CARGO (fork TOQ, módulo clínica).
 *
 * A equipe da clínica não é técnica. Com o módulo instalado, quem administra abre a interface
 * de um membro em Equipe e escolhe o cargo: "Recepção" deixa o menu só com Balcão, Agenda,
 * conversas, pacientes e tarefas, e a pessoa passa a começar o dia no Balcão.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-menu-por-cargo");

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

const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

test.describe("Menu pronto por cargo com o módulo clínica", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("a recepção recebe um menu enxuto e começa o dia no Balcão", async ({
    page,
    context,
    browser,
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

    await context.clearCookies();
    await loginComoAdmin(page, creds);
    const adminId = await idDoUsuario(creds.users.admin!.email);
    const { data: vinculo, error: erroVinculo } = await admin
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", adminId)
      .limit(1)
      .single();
    if (erroVinculo || !vinculo) throw new Error(`user_organizations: ${erroVinculo?.message}`);
    const orgId = (vinculo as { organization_id: string }).organization_id;

    const email = `recepcao-${randomUUID().slice(0, 8)}@invariant.test`;
    const senha = `Local-${randomUUID()}!`;
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });
    if (erroCriar || !criado.user) throw new Error(`createUser: ${erroCriar?.message}`);
    const membroId = criado.user.id;
    const membroContexto = await browser.newContext();
    try {
      const { error: erroMembro } = await admin.from("user_organizations").insert({
        user_id: membroId,
        organization_id: orgId,
        role: "agent",
        accepted_at: new Date().toISOString(),
      } as never);
      if (erroMembro) throw new Error(`user_organizations insert: ${erroMembro.message}`);

      // Quem administra escolhe o cargo, sem marcar área por área.
      await page.goto("/app/team");
      await page.getByRole("button", { name: `Interface de ${email}`, exact: true }).click();
      const janela = page.getByRole("dialog");
      await janela.getByTestId("cargo-recepcao").click();
      await expect(janela.getByTestId("cargo-recepcao")).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({ path: path.join(EVIDENCIA, "escolher-cargo.png") });
      await janela.getByRole("button", { name: "Salvar interface" }).click();
      await expect(janela).toHaveCount(0, { timeout: ESPERA });

      // A pessoa entra e cai no Balcão, com o menu só do que usa.
      const membro = await membroContexto.newPage();
      await membro.goto("/login");
      await membro.getByLabel(/e-?mail/i).fill(email);
      await membro.getByLabel(/senha/i).fill(senha);
      await membro.getByRole("button", { name: "Entrar", exact: true }).click();
      await membro.waitForURL(/\/app\/clinica\/balcao/, { timeout: 60_000 });
      await expect(membro.getByRole("heading", { name: "Balcão" })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(nav(membro).getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
      await expect(nav(membro).getByRole("link", { name: "Balcão", exact: true })).toBeVisible();
      await expect(nav(membro).getByRole("link", { name: "Radar", exact: true })).toHaveCount(0);
      await expect(membro.getByText("Carregando o dia…")).toHaveCount(0, { timeout: ESPERA });
      await membro.screenshot({ path: path.join(EVIDENCIA, "recepcao-no-balcao.png") });
    } finally {
      await membroContexto.close();
      await admin.from("user_organizations").delete().eq("user_id", membroId);
      await admin.auth.admin.deleteUser(membroId);
    }
  });
});
