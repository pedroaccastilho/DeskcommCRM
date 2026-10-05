/**
 * PERFIS DA EQUIPE NO CADASTRO DO USUÁRIO (fork TOQ, migration 9008).
 *
 * Pedido do Pedro (2026-10-04): só o administrador cadastra; os perfis são escolhidos no
 * cadastro, e a mesma pessoa pode somar vários (gerente e fisioterapeuta; jurídico, financeiro e
 * gerente). Escolher um perfil de saúde pede o registro do conselho na mesma folha, e a pessoa
 * já entra com o que aquele perfil vê e faz.
 *
 * A prova dirige a tela `/novo/equipe` como o administrador faria e confere no banco o que o
 * gesto gravou: papel, cadastro de profissional e a lista de perfis. Depois, um convite com três
 * perfis é aceito por quem foi convidado, e os perfis chegam junto.
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
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-perfis-da-equipe");

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

test.describe("Perfis da equipe escolhidos no cadastro", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("o administrador soma perfis, e o convite leva os perfis até o aceite", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(240_000);
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
      .eq("role", "admin")
      .limit(1)
      .single();
    if (erroVinculo || !vinculo) throw new Error(`user_organizations: ${erroVinculo?.message}`);
    const orgId = (vinculo as { organization_id: string }).organization_id;

    const sufixo = randomUUID().slice(0, 8);
    const emailMembro = `gerente-fisio-${sufixo}@invariant.test`;
    const emailConvidado = `juridico-${sufixo}@invariant.test`;
    const senha = `Local-${randomUUID()}!`;
    const criados: string[] = [];
    const convidadoContexto = await browser.newContext();
    try {
      const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
        email: emailMembro,
        password: senha,
        email_confirm: true,
        user_metadata: { full_name: `Ana Gerente ${sufixo}` },
      });
      if (erroCriar || !criado.user) throw new Error(`createUser: ${erroCriar?.message}`);
      const membroId = criado.user.id;
      criados.push(membroId);
      const { error: erroMembro } = await admin.from("user_organizations").insert({
        user_id: membroId,
        organization_id: orgId,
        role: "agent",
        accepted_at: new Date().toISOString(),
      } as never);
      if (erroMembro) throw new Error(`user_organizations insert: ${erroMembro.message}`);

      // ── 1. Somar Gerente + Fisioterapeuta numa pessoa que já está na equipe ──
      await page.goto("/novo/equipe");
      await expect(page.getByTestId("novo-equipe")).toBeVisible({ timeout: ESPERA });
      const linha = page.getByTestId("novo-equipe-membro").filter({ hasText: emailMembro });
      await expect(linha.getByText("Recepção", { exact: true })).toBeVisible({ timeout: ESPERA });
      await linha.click();

      const folha = page.getByTestId("novo-folha-perfis");
      await folha.getByTestId("novo-perfil-recepcao").click();
      await folha.getByTestId("novo-perfil-gerente").click();
      await folha.getByTestId("novo-perfil-fisioterapeuta").click();
      await expect(folha.getByText("Registro no CREFITO")).toBeVisible();
      await folha.getByLabel("Nome como está no conselho").fill(`Ana Souza ${sufixo}`);
      await folha.getByLabel("Número do registro").fill("12345-F");
      await folha.getByLabel("UF do registro").selectOption("SP");
      await page.screenshot({ path: path.join(EVIDENCIA, "somar-perfis.png") });
      await folha.getByTestId("novo-perfis-salvar").click();
      await expect(folha).toHaveCount(0, { timeout: ESPERA });

      await expect(linha.getByText("Gerente", { exact: true })).toBeVisible({ timeout: ESPERA });
      await expect(linha.getByText("Fisioterapeuta", { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "equipe-com-perfis.png") });

      const { data: papel } = await admin
        .from("user_organizations")
        .select("role, interface_settings")
        .eq("organization_id", orgId)
        .eq("user_id", membroId)
        .single();
      expect((papel as { role: string }).role).toBe("manager");
      const { data: prof } = await admin
        .from("clinica_profissionais")
        .select("conselho, modalidades, registro_numero, ativo")
        .eq("organization_id", orgId)
        .eq("user_id", membroId)
        .single();
      expect(prof).toEqual({
        conselho: "CREFITO",
        modalidades: ["fisioterapia", "pilates"],
        registro_numero: "12345-F",
        ativo: true,
      });
      const { data: perfis } = await admin
        .from("clinica_cargos_membro")
        .select("cargo")
        .eq("organization_id", orgId)
        .eq("user_id", membroId);
      expect((perfis ?? []).map((p) => p.cargo).sort()).toEqual(["fisioterapeuta", "gerente"]);

      // ── 2. Cadastrar uma pessoa nova com três perfis ─────────────────────────
      await page.getByTestId("novo-equipe-cadastrar").click();
      const cadastro = page.getByTestId("novo-folha-cadastro");
      await cadastro.getByTestId("novo-cadastro-email").fill(emailConvidado);
      await cadastro.getByTestId("novo-perfil-juridico").click();
      await cadastro.getByTestId("novo-perfil-financeiro").click();
      await cadastro.getByTestId("novo-perfil-gerente").click();
      await page.screenshot({ path: path.join(EVIDENCIA, "cadastrar-pessoa.png") });
      await cadastro.getByTestId("novo-cadastro-enviar").click();
      const link = cadastro.getByTestId("novo-link-do-convite");
      await expect(link).toBeVisible({ timeout: ESPERA });
      const url = (await link.textContent())?.trim() ?? "";
      expect(url).toContain("/team/accept-invite/");
      await page.screenshot({ path: path.join(EVIDENCIA, "convite-pronto.png") });
      await cadastro.getByRole("button", { name: "Pronto" }).click();

      // ── 3. Quem foi convidado aceita, e os três perfis chegam junto ──────────
      const { data: convidado, error: erroConvidado } = await admin.auth.admin.createUser({
        email: emailConvidado,
        password: senha,
        email_confirm: true,
      });
      if (erroConvidado || !convidado.user)
        throw new Error(`createUser: ${erroConvidado?.message}`);
      criados.push(convidado.user.id);
      const pagina = await convidadoContexto.newPage();
      await pagina.goto("/login");
      await pagina.getByLabel(/e-?mail/i).fill(emailConvidado);
      await pagina.getByLabel(/senha/i).fill(senha);
      await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
      await pagina.waitForLoadState("networkidle");
      await pagina.goto(new URL(url).pathname);
      await pagina.getByRole("button", { name: "Aceitar convite", exact: true }).click();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("clinica_cargos_membro")
              .select("cargo")
              .eq("organization_id", orgId)
              .eq("user_id", convidado.user!.id);
            return (data ?? []).map((p) => p.cargo).sort();
          },
          { timeout: ESPERA },
        )
        .toEqual(["financeiro", "gerente", "juridico"]);
      const { data: papelDoConvidado } = await admin
        .from("user_organizations")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", convidado.user.id)
        .single();
      expect((papelDoConvidado as { role: string }).role).toBe("manager");

      await page.reload();
      const linhaDoConvidado = page
        .getByTestId("novo-equipe-membro")
        .filter({ hasText: emailConvidado });
      await expect(linhaDoConvidado.getByText("Jurídico", { exact: true })).toBeVisible({
        timeout: ESPERA,
      });
      await expect(linhaDoConvidado.getByText("Financeiro", { exact: true })).toBeVisible();
      await page.screenshot({
        path: path.join(EVIDENCIA, "convidado-entrou-com-perfis.png"),
        fullPage: true,
      });
    } finally {
      await convidadoContexto.close();
      for (const id of criados) {
        await admin.from("clinica_cargos_membro").delete().eq("user_id", id);
        await admin.from("clinica_profissionais").delete().eq("user_id", id);
        await admin.from("user_organizations").delete().eq("user_id", id);
        await admin.auth.admin.deleteUser(id);
      }
      await admin.from("team_invites").delete().eq("email", emailConvidado);
    }
  });
});
