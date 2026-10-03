import { describe, expect, it } from "vitest";

import {
  INTERFACE_COMPLETA,
  destinosDaInterface,
  essencial,
  homeDaInterface,
  interfaceSettingsSchema,
  interfaceTemDestino,
} from "@/lib/navigation/interface";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import { MENUS_POR_CARGO, cargoDaInterface, interfaceDoCargo } from "./menus-por-cargo";

const portasDoMenu = (cargo: Parameters<typeof interfaceDoCargo>[0]) =>
  destinosDaInterface(interfaceDoCargo(cargo), false, "agent", ["clinica"])
    .filter((d) => !essencial(d, "agent"))
    .map((d) => d.href);

describe("menus prontos por cargo da clínica", () => {
  it("todo destino existe no catálogo e o schema aceita o menu", () => {
    const hrefs = new Set(NAV_CATALOG.map((d) => d.href));
    for (const menu of MENUS_POR_CARGO) {
      for (const d of menu.destinos) expect(hrefs.has(d), `${menu.id}: ${d}`).toBe(true);
      expect(interfaceSettingsSchema.safeParse(interfaceDoCargo(menu.id)).success).toBe(true);
      expect(interfaceTemDestino(interfaceDoCargo(menu.id), "agent")).toBe(true);
    }
  });

  it("a recepção vê o Balcão e as conversas; o profissional vê as evoluções e não a inbox", () => {
    expect(portasDoMenu("recepcao")).toEqual(
      expect.arrayContaining(["/app/clinica/balcao", "/app/agenda", "/app/inbox"]),
    );
    expect(portasDoMenu("saude")).toContain("/app/clinica/pendencias");
    expect(portasDoMenu("saude")).not.toContain("/app/inbox");
    expect(portasDoMenu("saude")).toContain("/app/clinica/meu-dia");
    expect(portasDoMenu("educador")).toEqual([
      "/app/agenda",
      "/app/clinica/meu-dia",
      "/app/contacts",
      "/app/tasks",
    ]);
  });

  it("cada cargo abre na sua tela; o menu completo continua abrindo na inbox", () => {
    expect(homeDaInterface(interfaceDoCargo("recepcao"), false, "agent")).toBe(
      "/app/clinica/balcao",
    );
    expect(homeDaInterface(interfaceDoCargo("saude"), false, "agent")).toBe("/app/clinica/meu-dia");
    expect(homeDaInterface(interfaceDoCargo("educador"), false, "agent")).toBe(
      "/app/clinica/meu-dia",
    );
    expect(homeDaInterface(INTERFACE_COMPLETA, false, "agent")).toBe("/app/inbox");
  });

  it("o cargo não concede o que o papel não dá: somente leitura não vê o Balcão", () => {
    const hrefs = destinosDaInterface(interfaceDoCargo("recepcao"), false, "viewer").map(
      (d) => d.href,
    );
    expect(hrefs).not.toContain("/app/clinica/balcao");
  });

  it("o editor reconhece o cargo da escolha atual, sem depender da ordem", () => {
    expect(cargoDaInterface(interfaceDoCargo("saude"))).toBe("saude");
    const invertida = { ...interfaceDoCargo("educador") };
    invertida.destinos = [...invertida.destinos!].reverse();
    expect(cargoDaInterface(invertida)).toBe("educador");
    expect(cargoDaInterface(INTERFACE_COMPLETA)).toBeNull();
    expect(cargoDaInterface({ preset: "completa", destinos: ["/app/agenda"] })).toBeNull();
  });
});
