/**
 * "ENTRAR COMO" (fork TOQ): o administrador vê o sistema como outra pessoa da equipe e volta.
 *
 * Pedido do Pedro (2026-10-04): "o administrador pode se logar com outros perfis (sendo possível
 * reverter), pra que ele possa validar a visão deles". A prova dirige a tela como o
 * administrador faria: abre a Equipe, entra como uma fisioterapeuta, vê a tela dela com a faixa
 * fixa, confirma que nada pode ser gravado nesse modo e volta. Os dois gestos ficam na auditoria
 * em nome do administrador.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `clinica-prontuario`.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";

import { carregarEnvLocal, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ESPERA = 30_000;
const EVIDENCIA =
  process.env.E2E_EVIDENCIA ?? path.join(process.cwd(), "evidence/clinica-entrar-como");

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

test.describe("Administrador entra como outra pessoa da equipe", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("vê a tela da fisioterapeuta, não grava nada e volta", async ({ page, context }) => {
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
    const email = `fisio-vista-${sufixo}@invariant.test`;
    const nome = `Bia ${sufixo}`;
    let fisioId: string | null = null;
    try {
      const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
        email,
        password: `Local-${randomUUID()}!`,
        email_confirm: true,
        user_metadata: { full_name: nome },
      });
      if (erroCriar || !criado.user) throw new Error(`createUser: ${erroCriar?.message}`);
      fisioId = criado.user.id;
      const semear = [
        await admin.from("user_organizations").insert({
          user_id: fisioId,
          organization_id: orgId,
          role: "agent",
          accepted_at: new Date().toISOString(),
        } as never),
        await admin.from("clinica_profissionais").insert({
          organization_id: orgId,
          user_id: fisioId,
          nome_profissional: nome,
          conselho: "CREFITO",
          registro_numero: "777-F",
          registro_uf: "SP",
          modalidades: ["fisioterapia", "pilates"],
          ativo: true,
        } as never),
        await admin.from("clinica_cargos_membro").insert({
          organization_id: orgId,
          user_id: fisioId,
          cargo: "fisioterapeuta",
        } as never),
      ];
      for (const r of semear) if (r.error) throw new Error(`semear: ${r.error.message}`);

      // ── 1. Na Equipe, o administrador abre a pessoa e entra como ela ──────────
      await page.goto("/novo/equipe");
      await expect(page.getByTestId("novo-equipe")).toBeVisible({ timeout: ESPERA });
      await page.getByTestId("novo-equipe-membro").filter({ hasText: email }).click();
      const folha = page.getByTestId("novo-folha-perfis");
      await expect(folha.getByTestId("novo-entrar-como")).toHaveText("Entrar como Bia");
      await folha.getByTestId("novo-entrar-como").click();

      // ── 2. A tela passa a ser a dela, com a faixa fixa ────────────────────────
      await page.waitForURL(/\/novo$/, { timeout: ESPERA });
      const faixa = page.getByTestId("novo-faixa-ver-como");
      await expect(faixa).toContainText(`Você está vendo como ${nome}.`, { timeout: ESPERA });
      const trilho = page.locator("nav.n-trilho");
      await expect(trilho.getByRole("link", { name: "Meu dia" })).toBeVisible();
      await expect(trilho.getByRole("link", { name: "Meus pacientes" })).toBeVisible();
      await expect(page.getByTestId("novo-porta-equipe")).toHaveCount(0);
      await page.screenshot({ path: path.join(EVIDENCIA, "vendo-como-fisioterapeuta.png") });

      // ── 3. Nada é gravado nesse modo, nem pelo administrador ──────────────────
      const tentativa = await page.request.put(`/api/v1/clinica/equipe/${fisioId}`, {
        data: { cargos: ["recepcao"] },
      });
      expect(tentativa.status()).toBe(403);
      expect(((await tentativa.json()) as { error: { message: string } }).error.message).toContain(
        "só olhar",
      );
      const { data: perfis } = await admin
        .from("clinica_cargos_membro")
        .select("cargo")
        .eq("organization_id", orgId)
        .eq("user_id", fisioId);
      expect((perfis ?? []).map((p) => p.cargo)).toEqual(["fisioterapeuta"]);

      // ── 4. Volta para o administrador ─────────────────────────────────────────
      await faixa.getByTestId("novo-voltar-ao-administrador").click();
      await page.waitForURL(/\/novo\/equipe$/, { timeout: ESPERA });
      await expect(page.getByTestId("novo-equipe")).toBeVisible({ timeout: ESPERA });
      await expect(page.getByTestId("novo-faixa-ver-como")).toHaveCount(0);
      await expect(page.getByTestId("novo-porta-equipe")).toBeVisible();
      await page.screenshot({ path: path.join(EVIDENCIA, "de-volta-ao-administrador.png") });

      // ── 5. Os dois gestos ficam na auditoria, em nome do administrador ────────
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("api_audit_log")
              .select("action")
              .eq("organization_id", orgId)
              .eq("actor_user_id", adminId)
              .eq("resource_id", fisioId!)
              .in("action", ["clinica.ver_como_iniciado", "clinica.ver_como_encerrado"]);
            return (data ?? []).map((l) => l.action as string).sort();
          },
          { timeout: ESPERA },
        )
        .toEqual(["clinica.ver_como_encerrado", "clinica.ver_como_iniciado"]);
    } finally {
      if (fisioId) {
        await admin.from("clinica_cargos_membro").delete().eq("user_id", fisioId);
        await admin.from("clinica_profissionais").delete().eq("user_id", fisioId);
        await admin.from("user_organizations").delete().eq("user_id", fisioId);
        await admin.auth.admin.deleteUser(fisioId);
      }
    }
  });
});
