import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { menuDoCargo } from "./cargo";
import { TELAS_DA_INTERFACE_NOVA, ehDaInterfaceNova, redirecionamentosDoNovo } from "./rotas";

describe("os endereços da interface nova moram na raiz", () => {
  it("cada tela tem página em app/(nova), sem /novo na URL", () => {
    for (const tela of TELAS_DA_INTERFACE_NOVA) {
      const pagina = path.join(process.cwd(), "app", "(nova)", tela, "page.tsx");
      expect(existsSync(pagina), `/${tela} sem ${pagina}`).toBe(true);
    }
    expect(existsSync(path.join(process.cwd(), "app", "novo"))).toBe(false);
  });

  it("o menu de todo cargo só aponta para telas da interface nova", () => {
    for (const cargo of ["recepcao", "saude", "educador", "gestao"] as const) {
      for (const item of menuDoCargo(cargo, true)) {
        expect(item.href.startsWith("/novo"), item.href).toBe(false);
        expect(ehDaInterfaceNova(item.href), item.href).toBe(true);
      }
    }
  });

  it("reconhece as telas e só elas", () => {
    expect(ehDaInterfaceNova("/hoje")).toBe(true);
    expect(ehDaInterfaceNova("/pacientes/4c97628c-6540-4f09-8c32-1bc43e99098a")).toBe(true);
    expect(ehDaInterfaceNova("/agendamento")).toBe(false);
    expect(ehDaInterfaceNova("/app/agenda")).toBe(false);
    expect(ehDaInterfaceNova("/")).toBe(false);
  });

  it("os endereços antigos levam aos novos, e só para as telas conhecidas", () => {
    const [raiz, telas] = redirecionamentosDoNovo();
    expect(raiz).toEqual({ source: "/novo", destination: "/hoje", permanent: false });
    expect(telas!.source).toBe(
      "/novo/:tela(agenda|pacientes|whatsapp|funis|leads|tarefas|relatorios|equipe|conta|ajustes)/:resto*",
    );
    expect(telas!.destination).toBe("/:tela/:resto*");
  });
});
