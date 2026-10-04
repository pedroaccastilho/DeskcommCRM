/**
 * Os PERFIS (cargos) de cada pessoa da equipe da clínica (fork TOQ, migration 9008).
 *
 * Pedido do Pedro (2026-10-04): o administrador escolhe os perfis no cadastro do usuário, e o
 * sistema entende sozinho o que aquela pessoa vê e faz. Escolher "Médico" já dá o papel, o menu e
 * o cadastro de profissional de saúde (conselho CRM, modalidade medicina), sem uma segunda tela.
 * TODO usuário pode ter mais de um perfil, e o acesso é a SOMA: a pessoa que é do jurídico, do
 * financeiro e gerente faz o que os três fazem; o gerente que também é fisioterapeuta vê os
 * relatórios e também atende, lê o prontuário e assina as próprias evoluções.
 *
 * Os perfis ficam em `clinica_cargos_membro`. Escolher os perfis grava também três coisas que o
 * sistema já sabia ler:
 *
 *  - o papel do núcleo (`user_organizations.role`), o MAIOR que os perfis pedem: Administrador →
 *    `admin`; Gerente, Financeiro e Jurídico → `manager` (relatórios, financeiro e auditoria do
 *    núcleo pedem esse degrau); o resto → `agent`. O papel é uma régua só, então a soma fina
 *    (o que só o Jurídico ou só o Financeiro vê) é decidida pelas telas do módulo com `temCargo`;
 *  - o menu da interface atual (`user_organizations.interface_settings`): a união dos menus;
 *  - o cadastro de profissional de saúde (`clinica_profissionais`): ativo, com o conselho e as
 *    modalidades do perfil de saúde (no máximo um, porque o cadastro tem um conselho); sem perfil
 *    de saúde, desativado (nunca apagado, porque o cadastro assina os registros que já existem).
 *
 * Quem não tem linha (todo mundo antes da 9008) tem os perfis CALCULADOS do papel e do cadastro
 * de profissional (`cargosDoUsuario`): ninguém muda de acesso ao atualizar.
 *
 * Quem decide acesso continua sendo a RLS e a rota; este arquivo só diz o que cada perfil grava.
 */
import { INTERFACE_COMPLETA, type InterfaceSettings } from "@/lib/navigation/interface";
import type { Role } from "@/lib/auth/types";

import { interfaceDoCargo, type CargoDaClinica } from "./menus-por-cargo";
import type { Conselho, Modalidade } from "./vocabulario";

export const CARGOS_DE_SAUDE = ["medico", "fisioterapeuta", "enfermeiro", "educador"] as const;
export type CargoDeSaude = (typeof CARGOS_DE_SAUDE)[number];

/** Perfis que pedem o degrau `manager` ou mais no núcleo e veem o CRM inteiro. */
export const CARGOS_DE_GESTAO = ["administrador", "gerente", "financeiro", "juridico"] as const;
export type CargoDeGestao = (typeof CARGOS_DE_GESTAO)[number];

export const CARGOS = [...CARGOS_DE_GESTAO, "recepcao", ...CARGOS_DE_SAUDE] as const;
export type CargoDoUsuario = (typeof CARGOS)[number];

export const ROTULO_DO_CARGO_DO_USUARIO: Record<CargoDoUsuario, string> = {
  administrador: "Administrador(a)",
  gerente: "Gerente",
  financeiro: "Financeiro",
  juridico: "Jurídico",
  recepcao: "Recepção",
  medico: "Médico(a)",
  fisioterapeuta: "Fisioterapeuta",
  enfermeiro: "Enfermeiro(a)",
  educador: "Educador(a) físico(a)",
};

/** O que cada perfil de saúde grava no cadastro de profissional. */
export const SAUDE_DO_CARGO: Record<
  CargoDeSaude,
  { conselho: Extract<Conselho, "CRM" | "CREFITO" | "COREN" | "CREF">; modalidades: Modalidade[] }
> = {
  medico: { conselho: "CRM", modalidades: ["medicina"] },
  // Pilates também é dado por fisioterapeuta, e aluno com dor só faz com fisioterapeuta.
  fisioterapeuta: { conselho: "CREFITO", modalidades: ["fisioterapia", "pilates"] },
  enfermeiro: { conselho: "COREN", modalidades: ["enfermagem"] },
  educador: { conselho: "CREF", modalidades: ["pilates"] },
};

export function ehCargo(valor: string): valor is CargoDoUsuario {
  return (CARGOS as readonly string[]).includes(valor);
}

export function ehCargoDeSaude(cargo: CargoDoUsuario): cargo is CargoDeSaude {
  return (CARGOS_DE_SAUDE as readonly string[]).includes(cargo);
}

export function ehCargoDeGestao(cargo: CargoDoUsuario): cargo is CargoDeGestao {
  return (CARGOS_DE_GESTAO as readonly string[]).includes(cargo);
}

/** O perfil de saúde de uma lista, se houver (no máximo um). */
export function cargoDeSaudeDe(cargos: readonly CargoDoUsuario[]): CargoDeSaude | null {
  return cargos.find(ehCargoDeSaude) ?? null;
}

export function temCargo(cargos: readonly CargoDoUsuario[], ...algum: CargoDoUsuario[]): boolean {
  return algum.some((c) => cargos.includes(c));
}

/** Por que uma combinação de perfis não vale, em linguagem de quem usa; `null` quando vale. */
export function problemaNosCargos(cargos: readonly CargoDoUsuario[]): string | null {
  if (cargos.length === 0) return "Escolha pelo menos um perfil.";
  if (new Set(cargos).size !== cargos.length) return "Perfil repetido.";
  if (cargos.filter(ehCargoDeSaude).length > 1) {
    return "Escolha só um perfil de saúde: o registro no conselho é um só.";
  }
  return null;
}

/** Ordem fixa de exibição, a mesma de `CARGOS`. */
export function ordenarCargos(cargos: readonly CargoDoUsuario[]): CargoDoUsuario[] {
  return [...new Set(cargos)].sort((a, b) => CARGOS.indexOf(a) - CARGOS.indexOf(b));
}

export interface CadastroLido {
  conselho: string;
  ativo: boolean;
}

/**
 * Os perfis de quem já está na equipe: os gravados em `clinica_cargos_membro`, ou, sem nenhum,
 * os calculados do papel e do cadastro de profissional. Profissional ativo com conselho que não
 * é de nenhum perfil da clínica (CRN, CRP ou "outro", feito na tela antiga) não ganha perfil de
 * saúde: a tela mostra o cadastro e deixa o administrador escolher.
 */
export function cargosDoUsuario(
  role: Role,
  profissional: CadastroLido | null,
  gravados: readonly string[] = [],
): CargoDoUsuario[] {
  const validos = gravados.filter(ehCargo);
  if (validos.length > 0) return ordenarCargos(validos);

  const cargos: CargoDoUsuario[] = [];
  if (role === "admin") cargos.push("administrador");
  else if (role === "manager") cargos.push("gerente");
  if (profissional?.ativo) {
    const saude = CARGOS_DE_SAUDE.find((c) => SAUDE_DO_CARGO[c].conselho === profissional.conselho);
    if (saude) cargos.push(saude);
    else if (cargos.length === 0) return [];
  }
  return cargos.length > 0 ? cargos : ["recepcao"];
}

/** O papel do núcleo: o maior que algum dos perfis pede. */
export function papelDosCargos(
  cargos: readonly CargoDoUsuario[],
): Extract<Role, "admin" | "manager" | "agent"> {
  if (cargos.includes("administrador")) return "admin";
  if (cargos.some(ehCargoDeGestao)) return "manager";
  return "agent";
}

/** O menu da interface atual: gestão vê o CRM inteiro; o resto, a união dos menus prontos. */
export function interfaceDosCargos(cargos: readonly CargoDoUsuario[]): InterfaceSettings {
  if (cargos.some(ehCargoDeGestao)) return INTERFACE_COMPLETA;
  const menus = new Set<CargoDaClinica>();
  for (const c of cargos) {
    if (c === "recepcao") menus.add("recepcao");
    else if (c === "educador") menus.add("educador");
    else if (ehCargoDeSaude(c)) menus.add("saude");
  }
  if (menus.size === 0) menus.add("recepcao");
  const destinos = [...menus].flatMap((m) => interfaceDoCargo(m).destinos ?? []);
  return { preset: "completa", destinos: [...new Set(destinos)] };
}
