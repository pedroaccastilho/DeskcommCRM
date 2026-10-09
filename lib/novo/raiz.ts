/**
 * A INTERFACE NOVA É A PRINCIPAL para quem não administra (Pedro, 2026-10-04).
 *
 * "Os perfis que não são de administradores nem terão a visão antiga do sistema." Quem não é
 * Administrador e abre uma tela da interface atual que já tem equivalente na nova é levado para
 * ela, com o mesmo paciente, a mesma conversa. Só o Administrador alterna entre as duas.
 *
 * O que fica de fora, de propósito:
 *  - tela SEM equivalente na nova: continua abrindo na interface atual, para ninguém perder uma
 *    função que só existe lá;
 *  - sessão de suporte e administrador da plataforma: trabalham na interface atual;
 *  - instalação sem o módulo clínica: a interface nova não tem o que mostrar.
 *
 * Só vale quando a ORGANIZAÇÃO escolheu assim (`clinica_politicas.interface_nova_principal`,
 * migration 9010, ligada pelo Administrador no menu da pessoa da interface nova): instalar ou
 * atualizar o módulo não muda a tela de ninguém. A leitura mora em `raiz-servidor.ts`.
 *
 * Não decide acesso: a RLS e as rotas decidem. Só decide onde a pessoa trabalha.
 */
import type { Role } from "@/lib/auth/types";

export interface QuemAbre {
  role: Role;
  isPlatformAdmin: boolean;
  suporte: boolean;
  clinicaInstalada: boolean;
}

/** Quem trabalha só na interface nova. */
export function usaSoAInterfaceNova(q: QuemAbre): boolean {
  return q.clinicaInstalada && q.role !== "admin" && !q.isPlatformAdmin && !q.suporte;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * A tela da interface nova que faz o papel de uma tela da atual; `null` quando não há
 * equivalente (a pessoa continua na atual). `busca` é o `?…` original, sem o `?`.
 */
export function destinoNaInterfaceNova(caminho: string, busca = ""): string | null {
  const p = caminho.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(busca);

  if (p === "/app") return "/hoje";
  if (/^\/app\/clinica\/(balcao|meu-dia|pendencias)$/.test(p)) return "/hoje";
  if (p === "/app/agenda") return "/agenda";
  if (p === "/app/tasks") return "/tarefas";
  if (p === "/app/clinica/origens") return "/relatorios";
  if (p === "/app/contacts") return "/pacientes";
  if (p === "/app/settings/profile") return "/conta";
  if (p === "/app/settings/security") return "/conta/seguranca";
  if (p === "/app/settings/notifications") return "/conta/avisos";
  const ficha = p.match(new RegExp(`^/app/contacts/(${UUID})$`, "i"));
  if (ficha) return `/pacientes/${ficha[1]}`;
  if (p === "/app/inbox") {
    const id = q.get("id");
    return id && new RegExp(`^${UUID}$`, "i").test(id) ? `/whatsapp?id=${id}` : "/whatsapp";
  }
  const conversa = p.match(new RegExp(`^/app/inbox/(${UUID})$`, "i"));
  if (conversa) return `/whatsapp?id=${conversa[1]}`;
  // Os leads: a lista dos funis, o quadro de um funil (com o negócio aberto) e um negócio.
  if (p === "/app/kanban") return "/funis";
  const funil = p.match(new RegExp(`^/app/pipelines/(${UUID})$`, "i"));
  if (funil) {
    const lead = q.get("lead");
    return lead && new RegExp(`^${UUID}$`, "i").test(lead)
      ? `/funis/${funil[1]}?lead=${lead}`
      : `/funis/${funil[1]}`;
  }
  const negocio = p.match(new RegExp(`^/app/leads/(${UUID})$`, "i"));
  if (negocio) return `/leads/${negocio[1]}`;
  return null;
}
