/**
 * O CARGO de quem abre a interface nova (`/novo`, teste A/B da TOQ).
 *
 * A interface atual mostra o CRM inteiro a todo mundo. A nova mostra a cada pessoa só o trabalho
 * dela, e o cargo é deduzido do que já está cadastrado, sem pedir nada a ninguém:
 *
 *  - Administrador → gestão, SEMPRE, mesmo que também atenda (decisão do Pedro, 2026-10-03:
 *    "o administrador tem acesso a tudo, independente de cargo e função");
 *  - profissional de saúde ativo com conselho CREF → educador físico (turmas e alunos);
 *  - outro profissional de saúde ativo → profissional, só da própria área (fisioterapeuta vê
 *    fisioterapia, médico vê medicina);
 *  - Gerente que não atende → gestão (vê a clínica inteira);
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
  if (role === "admin") return "gestao";
  if (profissional?.ativo) return profissional.conselho === "CREF" ? "educador" : "saude";
  if (ROLE_RANK[role] >= ROLE_RANK.manager) return "gestao";
  return "recepcao";
}

/** Quem atende vê só a própria agenda por padrão; recepção e gestão veem a clínica. */
export function atende(cargo: Cargo): boolean {
  return cargo === "saude" || cargo === "educador";
}

/**
 * As visões que a pessoa pode abrir pelo menu. Administrador e Gerente veem a clínica inteira e
 * podem abrir a visão da recepção e a do profissional (a "Meu dia" mostra as sessões de quem
 * está logado). Quem atende e é Gerente alterna entre o próprio dia e a gestão. O papel no banco
 * não muda: uma ação que o papel não permite continua recusada pela rota.
 */
export function cargosParaVer(role: Role, real: Cargo): Cargo[] {
  if (ROLE_RANK[role] >= ROLE_RANK.manager) {
    return atende(real) ? [real, "gestao", "recepcao"] : ["gestao", "recepcao", "saude"];
  }
  return [real];
}

/** Configurações da clínica: só para o Administrador (Pedro, 2026-10-03). */
export function veConfiguracoes(role: Role): boolean {
  return role === "admin";
}

/**
 * As modalidades que a tela mostra para quem atende: só as do cadastro dele. Gestão e recepção
 * veem todas (`null`). Ex.: a fisioterapeuta não vê a agenda de medicina.
 */
export function modalidadesDaVisao(
  cargo: Cargo,
  profissional: CadastroDeProfissional | null,
): readonly string[] | null {
  if (!atende(cargo) || !profissional?.ativo) return null;
  return profissional.modalidades;
}

/**
 * O prontuário na tela (ler e escrever evolução): só para profissional de saúde ATIVO, e nunca
 * na tela da recepção. Quem é Administrador e também atende, ao abrir "Ver a tela de: Recepção",
 * vê o que a recepção vê, sem cartão de evoluções nem botão "Escrever" (Pedro, 2026-10-04).
 * A trava de verdade continua no banco (RLS e gatilho da migration 9001): sem cadastro ativo,
 * ninguém assina registro, qualquer que seja a tela.
 */
export function veProntuario(cargo: Cargo, profissional: CadastroDeProfissional | null): boolean {
  return Boolean(profissional?.ativo) && cargo !== "recepcao";
}

/** Escrever a evolução de uma sessão: além do prontuário, a modalidade tem de ser do cadastro. */
export function escreveEvolucao(
  cargo: Cargo,
  profissional: CadastroDeProfissional | null,
  modalidade: string | null | undefined,
): boolean {
  if (!veProntuario(cargo, profissional)) return false;
  return modalidade ? profissional!.modalidades.includes(modalidade) : true;
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
    ...(quemAtende
      ? []
      : [{ href: "/novo/whatsapp", rotulo: "WhatsApp", icone: "conversas" as const }]),
  ];
}
