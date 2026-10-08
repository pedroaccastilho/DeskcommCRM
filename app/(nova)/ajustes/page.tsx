import type { Metadata } from "next";

import { ListaDeAjustes, type GrupoDeAjustes } from "@/components/novo/Ajustes";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { cargosDoUsuario } from "@/lib/clinica/cargos";
import { telasDaGestao } from "@/lib/clinica/gestao";
import { traduzir } from "@/lib/i18n/dicionario";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { NAV_GROUPS } from "@/lib/navigation/catalogo";
import { permitidos } from "@/lib/navigation/interface";
import { enderecoDoAjuste } from "@/lib/novo/ajustes";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ajustes" };

/**
 * AJUSTES: tudo o que o Administrador configura, dentro da interface nova (`lib/novo/ajustes.ts`).
 * O conteúdo vem do catálogo de navegação, filtrado pelo papel, pelos módulos e pelas capacidades
 * como o menu da versão atual — esta tela não decide o que existe, só desenha.
 *
 * Para Gerente, Financeiro e Jurídico que não administram, a mesma lista vira a GESTÃO: só as telas
 * do perfil (`telasDaGestao`), e cada uma segue checando o papel sozinha.
 */
export default async function Ajustes() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const t = (texto: string) => traduzir(texto, user.idioma);
  const plataforma = user.is_platform_admin && !user.support;
  const role = org?.role ?? null;

  const admin = createAdminClient();
  let soEstas: Set<string> | null = null;
  if (!plataforma && role !== "admin" && org && role) {
    const gravados = await admin
      .from("clinica_cargos_membro")
      .select("cargo")
      .eq("organization_id", org.orgId)
      .eq("user_id", user.id);
    const cargos = cargosDoUsuario(
      role,
      null,
      (gravados.data ?? []).map((g) => g.cargo as string),
    );
    const telas = telasDaGestao(role, cargos);
    if (telas.length > 0) soEstas = new Set(telas);
  }

  if (!plataforma && role !== "admin" && !soEstas) {
    return (
      <div className="n-conteudo max-w-3xl" data-testid="novo-ajustes">
        <div className="rounded-[var(--n-raio)] border-2 border-dashed border-[var(--n-linha)] px-6 py-10 text-center">
          <p className="n-titulo text-xl">{t("Ajustes são do administrador")}</p>
        </div>
      </div>
    );
  }

  const [modulos, capacidades] = await Promise.all([
    modulosLigados(admin),
    org ? capacidadesDaOrganizacao(admin, org.orgId) : Promise.resolve([]),
  ]);
  // Na Gestão, a lista fechada do perfil decide (a LGPD do Jurídico pede `admin` no catálogo);
  // módulo e capacidade continuam valendo, e cada tela segue checando o papel sozinha.
  const visiveis = permitidos(plataforma, soEstas ? "admin" : role, modulos, capacidades).filter(
    (d) => !soEstas || soEstas.has(d.href),
  );

  const vistos = new Set<string>();
  const grupos: GrupoDeAjustes[] = [];
  for (const grupo of NAV_GROUPS) {
    const secoes = new Map<string, GrupoDeAjustes["secoes"][number]>();
    for (const d of visiveis) {
      if (d.group !== grupo.id) continue;
      const destino = enderecoDoAjuste(d.href);
      // Duas telas da atual podem levar à mesma da nova (o Balcão e o Meu dia viram "Hoje").
      if (vistos.has(destino.href)) continue;
      vistos.add(destino.href);
      const secao = secoes.get(d.section ?? "") ?? {
        titulo: d.section ? traduzir(d.section, user.idioma) : "",
        itens: [],
      };
      secao.itens.push({
        href: destino.href,
        naNova: destino.naNova,
        rotulo: traduzir(d.label, user.idioma),
        descricao: traduzir(d.description, user.idioma),
      });
      secoes.set(d.section ?? "", secao);
    }
    if (secoes.size === 0) continue;
    grupos.push({
      titulo: traduzir(grupo.label, user.idioma),
      secoes: [...secoes.values()],
    });
  }

  return soEstas ? (
    <ListaDeAjustes
      grupos={grupos}
      titulo={t("Gestão")}
      subtitulo={t("As telas de gestão do seu perfil.")}
    />
  ) : (
    <ListaDeAjustes grupos={grupos} />
  );
}
