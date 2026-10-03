/**
 * Menus prontos por cargo da clínica (fork TOQ).
 *
 * A equipe não é técnica: em vez de marcar áreas uma a uma, quem administra
 * escolhe o cargo e o menu da pessoa fica só com o que ela usa no dia. Cada
 * cargo é uma lista de `destinos` da escolha de interface que já existe
 * (`lib/navigation/interface.ts`), então nada muda no banco e a autorização
 * continua sendo o papel: um cargo nunca abre porta que o papel não dá.
 */
import type { NavDestinationId } from "@/lib/navigation/catalogo";
import type { InterfaceSettings } from "@/lib/navigation/interface";

export type CargoDaClinica = "recepcao" | "saude" | "educador";

export interface MenuDoCargo {
  id: CargoDaClinica;
  rotulo: string;
  descricao: string;
  destinos: readonly NavDestinationId[];
}

export const MENUS_POR_CARGO: readonly MenuDoCargo[] = [
  {
    id: "recepcao",
    rotulo: "Recepção",
    descricao: "Balcão, agenda, conversas, pacientes e tarefas. Abre no Balcão.",
    destinos: ["/app/clinica/balcao", "/app/agenda", "/app/inbox", "/app/contacts", "/app/tasks"],
  },
  {
    id: "saude",
    rotulo: "Profissional de saúde",
    descricao: "Meu dia, agenda, evoluções pendentes, pacientes e tarefas. Abre no Meu dia.",
    destinos: [
      "/app/clinica/meu-dia",
      "/app/agenda",
      "/app/clinica/pendencias",
      "/app/contacts",
      "/app/tasks",
    ],
  },
  {
    id: "educador",
    rotulo: "Educador físico",
    descricao: "Meu dia, agenda, alunos e tarefas. Abre no Meu dia.",
    destinos: ["/app/clinica/meu-dia", "/app/agenda", "/app/contacts", "/app/tasks"],
  },
];

/** O menu pronto de um cargo, na forma que o editor de interface grava. */
export function interfaceDoCargo(cargo: CargoDaClinica): InterfaceSettings {
  const menu = MENUS_POR_CARGO.find((m) => m.id === cargo)!;
  return { preset: "completa", destinos: [...menu.destinos] };
}

/** Qual cargo a escolha atual reproduz exatamente, para o editor marcar o botão. */
export function cargoDaInterface(settings: InterfaceSettings): CargoDaClinica | null {
  const atual = settings.destinos;
  if (!atual) return null;
  const achado = MENUS_POR_CARGO.find(
    (m) => m.destinos.length === atual.length && m.destinos.every((d) => atual.includes(d)),
  );
  return achado?.id ?? null;
}
