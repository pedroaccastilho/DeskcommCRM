import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import { AJUSTES_NA_INTERFACE_NOVA, enderecoDoAjuste } from "./ajustes";

const CATALOGO = new Set<string>(NAV_CATALOG.map((d) => d.href));

describe("os ajustes do administrador na interface nova", () => {
  it("cada tela migrada existe no catálogo e tem página que monta a MESMA página da atual", () => {
    for (const [atual, nova] of Object.entries(AJUSTES_NA_INTERFACE_NOVA)) {
      expect(CATALOGO.has(atual), `${atual} fora do catálogo de navegação`).toBe(true);
      const pagina = path.join(process.cwd(), "app", "(nova)", nova, "page.tsx");
      expect(existsSync(pagina), `${nova} sem ${pagina}`).toBe(true);
      expect(readFileSync(pagina, "utf8")).toContain(`from "@/app${atual}/page"`);
    }
  });

  it("toda tela do catálogo tem endereço: na nova quando já mora aqui, na atual quando não", () => {
    expect(enderecoDoAjuste("/app/settings/tenant/clinica/regras")).toEqual({
      href: "/ajustes/clinica/regras",
      naNova: true,
    });
    expect(enderecoDoAjuste("/app/team")).toEqual({ href: "/equipe", naNova: true });
    expect(enderecoDoAjuste("/app/agenda")).toEqual({ href: "/agenda", naNova: true });
    expect(enderecoDoAjuste("/app/kanban")).toEqual({ href: "/app/kanban", naNova: false });
  });
});
