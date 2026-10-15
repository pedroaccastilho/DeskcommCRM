/**
 * O que as rotas do painel financeiro (migration 9012) leem do banco, sempre com a organização da
 * sessão e o client de serviço (as funções são `security definer` e só o `service_role` executa;
 * `clinica_despesas` só o servidor escreve).
 *
 * As listas vêm em páginas de 1000 com `range`: o PostgREST corta em 1000 linhas sem avisar, e
 * uma lista de cobrança ou uma planilha com linha faltando parece certa.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

import type { Despesa, EntradaFinanceira, ItemAReceber } from "./financeiro";

type Admin = ReturnType<typeof createAdminClient>;
type Erro = { code?: string; message: string };

const PAGINA = 1000;

export interface Periodo {
  p_org: string;
  p_de: string;
  p_ate: string;
}

/** Até `teto` linhas; `cortado` diz se havia mais. */
export type Leitura<T> = { linhas: T[]; cortado: boolean } | { erro: Erro };

async function paginar<T>(
  pagina: (desde: number, ate: number) => PromiseLike<{ data: unknown; error: Erro | null }>,
  teto: number,
): Promise<Leitura<T>> {
  const linhas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    // Pede uma linha a mais que o teto para saber se cortou.
    const ate = Math.min(desde + PAGINA, teto + 1) - 1;
    const { data, error } = await pagina(desde, ate);
    if (error) return { erro: error };
    const lidas = (data ?? []) as T[];
    linhas.push(...lidas);
    if (linhas.length > teto) return { linhas: linhas.slice(0, teto), cortado: true };
    if (lidas.length < ate - desde + 1) return { linhas, cortado: false };
  }
}

export function lerEntradas(admin: Admin, args: Periodo, teto: number) {
  return paginar<EntradaFinanceira>(
    (desde, ate) => admin.rpc("fn_clinica_financeiro_entradas", args).range(desde, ate),
    teto,
  );
}

export function lerAReceber(admin: Admin, args: Periodo, teto: number) {
  return paginar<ItemAReceber>(
    (desde, ate) => admin.rpc("fn_clinica_financeiro_a_receber", args).range(desde, ate),
    teto,
  );
}

export function lerSaidas(admin: Admin, args: Periodo, teto: number) {
  return paginar<Despesa>(
    (desde, ate) =>
      admin
        .from("clinica_despesas")
        .select("id, descricao, categoria, forma, valor_cents, currency, pago_em")
        .eq("organization_id", args.p_org)
        .gte("pago_em", args.p_de)
        .lt("pago_em", args.p_ate)
        .order("pago_em", { ascending: false })
        .order("id")
        .range(desde, ate),
    teto,
  );
}
