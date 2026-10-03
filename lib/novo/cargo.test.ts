import { describe, expect, it } from "vitest";

import { cargoDe, cargosParaVer, menuDoCargo } from "./cargo";

describe("cargo na interface nova", () => {
  it("deduz o cargo do cadastro de profissional e do papel", () => {
    expect(cargoDe("agent", null)).toBe("recepcao");
    expect(cargoDe("admin", null)).toBe("gestao");
    expect(cargoDe("manager", null)).toBe("gestao");
    expect(cargoDe("agent", { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true })).toBe("saude");
    expect(cargoDe("agent", { conselho: "CREF", modalidades: ["pilates"], ativo: true })).toBe("educador");
    expect(cargoDe("admin", { conselho: "CRM", modalidades: ["medicina"], ativo: false })).toBe("gestao");
  });

  it("só gestão experimenta outros cargos", () => {
    expect(cargosParaVer("agent", "recepcao")).toEqual(["recepcao"]);
    expect(cargosParaVer("admin", "gestao")).toEqual(["gestao", "recepcao", "saude"]);
    expect(cargosParaVer("admin", "saude")).toEqual(["saude", "recepcao", "gestao"]);
  });

  it("o menu tem no máximo quatro portas e quem atende não vê o WhatsApp da clínica", () => {
    expect(menuDoCargo("recepcao").map((i) => i.rotulo)).toEqual(["Hoje", "Agenda", "Pacientes", "WhatsApp"]);
    expect(menuDoCargo("saude").map((i) => i.rotulo)).toEqual(["Meu dia", "Minha agenda", "Meus pacientes"]);
    expect(menuDoCargo("educador").map((i) => i.rotulo)).toEqual(["Meu dia", "Minha agenda", "Alunos"]);
  });
});
