import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import {
  AJUSTES_NA_INTERFACE_NOVA,
  DETALHES_NA_INTERFACE_NOVA,
  enderecoDoAjuste,
  enderecoNaInterfaceNova,
} from "./ajustes";

const CATALOGO = new Set<string>(NAV_CATALOG.map((d) => d.href));

describe("os ajustes do administrador na interface nova", () => {
  it("cada tela migrada existe no catálogo e tem página que monta a MESMA página da atual", () => {
    for (const [atual, nova] of Object.entries(AJUSTES_NA_INTERFACE_NOVA)) {
      expect(CATALOGO.has(atual), `${atual} fora do catálogo de navegação`).toBe(true);
      const pagina = path.join(process.cwd(), "app", "(nova)", nova, "page.tsx");
      expect(existsSync(pagina), `${nova} sem ${pagina}`).toBe(true);
      const fonte = readFileSync(pagina, "utf8");
      expect(fonte).toContain(`from "@/app${atual}/page"`);
      // Os layouts do caminho de lá recusam a tela com o módulo ou a capacidade desligado; sem
      // eles, a tela abriria aqui o que lá não existe.
      const partes = atual.split("/").filter(Boolean);
      for (let i = 2; i <= partes.length; i++) {
        const pasta = partes.slice(0, i).join("/");
        if (existsSync(path.join(process.cwd(), "app", ...partes.slice(0, i), "layout.tsx"))) {
          expect(fonte, `${nova} sem o layout de /${pasta}`).toContain(
            `from "@/app/${pasta}/layout"`,
          );
        }
      }
    }
  });

  it("toda tela do catálogo tem endereço: na nova quando já mora aqui, na atual quando não", () => {
    expect(enderecoDoAjuste("/app/settings/tenant/clinica/regras")).toEqual({
      href: "/ajustes/clinica/regras",
      naNova: true,
    });
    expect(enderecoDoAjuste("/app/team")).toEqual({ href: "/equipe", naNova: true });
    expect(enderecoDoAjuste("/app/agenda")).toEqual({ href: "/agenda", naNova: true });
    expect(enderecoDoAjuste("/app/kanban")).toEqual({ href: "/ajustes/funis", naNova: true });
    expect(enderecoDoAjuste("/app/crm")).toEqual({ href: "/app/crm", naNova: false });
  });

  it("nenhuma tela do catálogo ficou só na versão atual", () => {
    const fora = NAV_CATALOG.map((d) => d.href).filter((h) => !enderecoDoAjuste(h).naNova);
    expect(fora).toEqual([]);
  });

  it("cada tela de detalhe tem página aqui que monta a de lá (o negócio, que só redireciona, refaz o desvio)", () => {
    for (const [atual, nova] of DETALHES_NA_INTERFACE_NOVA) {
      const pagina = path.join(process.cwd(), "app", "(nova)", nova, "page.tsx");
      expect(existsSync(pagina), `${nova} sem ${pagina}`).toBe(true);
      const fonte = readFileSync(pagina, "utf8");
      if (atual === "/app/leads/[id]") expect(fonte).toContain("redirect(`/ajustes/funis/");
      else expect(fonte).toContain(`from "@/app${atual}/page"`);
    }
  });

  it("um link de lá leva à tela daqui, com o id e a busca; o que não tem par segue para lá", () => {
    const ID = "4c97628c-6540-4f09-8c32-1bc43e99098a";
    expect(enderecoNaInterfaceNova(`/app/pipelines/${ID}?lead=7`)).toBe(
      `/ajustes/funis/${ID}?lead=7`,
    );
    expect(enderecoNaInterfaceNova("/app/campaigns/new")).toBe("/ajustes/campanhas/nova");
    expect(enderecoNaInterfaceNova(`/app/campaigns/${ID}/edit`)).toBe(
      `/ajustes/campanhas/${ID}/editar`,
    );
    expect(enderecoNaInterfaceNova("/app/ai/agents/new")).toBe("/ajustes/ia/agentes/novo");
    expect(enderecoNaInterfaceNova(`/app/ai/agents/${ID}`)).toBe(`/ajustes/ia/agentes/${ID}`);
    expect(enderecoNaInterfaceNova("/app/settings/tags")).toBe("/ajustes/etiquetas");
    expect(enderecoNaInterfaceNova(`/app/contacts/${ID}`)).toBe(`/pacientes/${ID}`);
    expect(enderecoNaInterfaceNova("/app/crm")).toBeNull();
    expect(enderecoNaInterfaceNova("/app/settings/tags#x")).toBeNull();
    expect(enderecoNaInterfaceNova("https://exemplo.com/app/kanban")).toBeNull();
  });
});
