/**
 * O CARGO de quem abre a interface nova (`/novo`, teste A/B da TOQ).
 *
 * A interface atual mostra o CRM inteiro a todo mundo. A nova mostra a cada pessoa só o trabalho
 * dela, e o cargo é deduzido do que já está cadastrado, sem pedir nada a ninguém:
 *
 *  - profissional de saúde ativo com conselho CREF → educador físico (turmas e alunos);
 *  - outro profissional de saúde ativo → profissional (meu dia, minha agenda, meus pacientes);
 *  - Gerente ou Administrador que não atende → gestão (vê a clínica inteira);
 *  - o resto → recepção.
 *
 * Não decide acesso: quem decide é a RLS e o papel na rota. Só decide o que a tela mostra.
 */
import { ROLE_RANK, type Role } from "@/lib/auth/types";

export type Cargo = "recepcao" | "saude" | "educador" | "gestao";

export const ROTULO_DO_CARGO: Record<Cargo, string> = {
  recepcao: "Recepção",
  saude: "Profissional de saúde",
  educador: "Educador físico",
  gestao: "Gestão",
};

export interface CadastroDeProfissional {
  conselho: string;
  modalidades: readonly string[];
  ativo: boolean;
}

export function cargoDe(role: Role, profissional: CadastroDeProfissional | null): Cargo {
  if (profissional?.ativo) return profissional.conselho === "CREF" ? "educador" : "saude";
  if (ROLE_RANK[role] >= ROLE_RANK.manager) return "gestao";
  return "recepcao";
}

/** Quem atende vê só a própria agenda por padrão; recepção e gestão veem a clínica. */
export function atende(cargo: Cargo): boolean {
  return cargo === "saude" || cargo === "educador";
}

/**
 * Os cargos que a pessoa pode "experimentar" pelo menu, para comparar as telas. Gestão vê como
 * qualquer um; quem atende pode alternar entre o próprio dia e a visão da recepção. O papel no
 * banco não muda: uma ação que o papel não permite continua recusada pela rota.
 */
export function cargosParaVer(role: Role, real: Cargo): Cargo[] {
  if (ROLE_RANK[role] >= ROLE_RANK.manager) {
    return atende(real) ? [real, "recepcao", "gestao"] : ["gestao", "recepcao", "saude"];
  }
  return [real];
}

export interface ItemDoMenu {
  href: string;
  rotulo: string;
  icone: "hoje" | "agenda" | "pacientes" | "conversas";
}

/** O menu da interface nova: quatro portas no máximo, o nome conforme o cargo. */
export function menuDoCargo(cargo: Cargo): ItemDoMenu[] {
  const quemAtende = atende(cargo);
  return [
    { href: "/novo", rotulo: quemAtende ? "Meu dia" : "Hoje", icone: "hoje" },
    {
      href: "/novo/agenda",
      rotulo: quemAtende ? "Minha agenda" : "Agenda",
      icone: "agenda",
    },
    {
      href: "/novo/pacientes",
      rotulo: cargo === "educador" ? "Alunos" : quemAtende ? "Meus pacientes" : "Pacientes",
      icone: "pacientes",
    },
    ...(quemAtende ? [] : [{ href: "/app/inbox", rotulo: "WhatsApp", icone: "conversas" as const }]),
  ];
}
