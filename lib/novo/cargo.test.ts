import { describe, expect, it } from "vitest";

import {
  cargoDe,
  cargosParaVer,
  escreveEvolucao,
  menuDoCargo,
  modalidadesDaVisao,
  veConfiguracoes,
  veProntuario,
} from "./cargo";

describe("cargo na interface nova", () => {
  it("deduz o cargo do cadastro de profissional e do papel", () => {
    expect(cargoDe("agent", null)).toBe("recepcao");
    expect(cargoDe("admin", null)).toBe("gestao");
    expect(cargoDe("manager", null)).toBe("gestao");
    expect(
      cargoDe("agent", { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true }),
    ).toBe("saude");
    expect(cargoDe("agent", { conselho: "CREF", modalidades: ["pilates"], ativo: true })).toBe(
      "educador",
    );
    expect(cargoDe("admin", { conselho: "CRM", modalidades: ["medicina"], ativo: false })).toBe(
      "gestao",
    );
    // Administrador vê tudo mesmo quando também atende.
    expect(
      cargoDe("admin", { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true }),
    ).toBe("gestao");
    expect(
      cargoDe("manager", { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true }),
    ).toBe("saude");
  });

  it("só gestão experimenta outros cargos", () => {
    expect(cargosParaVer("agent", "recepcao")).toEqual(["recepcao"]);
    expect(cargosParaVer("admin", "gestao")).toEqual(["gestao", "recepcao", "saude"]);
    expect(cargosParaVer("manager", "saude")).toEqual(["saude", "gestao", "recepcao"]);
  });

  it("o menu tem no máximo quatro portas e quem atende não vê o WhatsApp da clínica", () => {
    expect(menuDoCargo("recepcao").map((i) => i.rotulo)).toEqual([
      "Hoje",
      "Agenda",
      "Pacientes",
      "WhatsApp",
    ]);
    expect(menuDoCargo("saude").map((i) => i.rotulo)).toEqual([
      "Meu dia",
      "Minha agenda",
      "Meus pacientes",
    ]);
    expect(menuDoCargo("educador").map((i) => i.rotulo)).toEqual([
      "Meu dia",
      "Minha agenda",
      "Alunos",
    ]);
  });

  it("os perfis somam: Gerente ou Financeiro ganha Relatórios em qualquer visão", () => {
    expect(menuDoCargo("gestao", true).map((i) => i.rotulo)).toEqual([
      "Hoje",
      "Agenda",
      "Pacientes",
      "WhatsApp",
      "Relatórios",
    ]);
    expect(menuDoCargo("saude", true).map((i) => i.rotulo)).toEqual([
      "Meu dia",
      "Minha agenda",
      "Meus pacientes",
      "Relatórios",
    ]);
  });
});

describe("cada um vê a própria área", () => {
  it("profissional vê só as modalidades do cadastro; gestão e recepção veem todas", () => {
    const fisio = { conselho: "CREFITO", modalidades: ["fisioterapia", "pilates"], ativo: true };
    expect(modalidadesDaVisao("saude", fisio)).toEqual(["fisioterapia", "pilates"]);
    expect(modalidadesDaVisao("gestao", fisio)).toBeNull();
    expect(modalidadesDaVisao("recepcao", null)).toBeNull();
  });

  it("configurações só para o administrador", () => {
    expect(veConfiguracoes("admin")).toBe(true);
    expect(veConfiguracoes("manager")).toBe(false);
  });

  it("recepção não lê prontuário nem escreve evolução, nem o administrador vendo a tela dela", () => {
    const fisio = { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true };
    expect(veProntuario("recepcao", null)).toBe(false);
    expect(veProntuario("gestao", null)).toBe(false);
    // Administrador que também atende, com "Ver a tela de: Recepção".
    expect(veProntuario("recepcao", fisio)).toBe(false);
    expect(escreveEvolucao("recepcao", fisio, "fisioterapia")).toBe(false);
    expect(veProntuario("gestao", fisio)).toBe(true);
    expect(veProntuario("saude", fisio)).toBe(true);
    expect(veProntuario("saude", { ...fisio, ativo: false })).toBe(false);
  });

  it("evolução só na modalidade do cadastro", () => {
    const fisio = { conselho: "CREFITO", modalidades: ["fisioterapia"], ativo: true };
    expect(escreveEvolucao("saude", fisio, "fisioterapia")).toBe(true);
    expect(escreveEvolucao("saude", fisio, "medicina")).toBe(false);
    expect(escreveEvolucao("saude", fisio, null)).toBe(true);
  });
});
