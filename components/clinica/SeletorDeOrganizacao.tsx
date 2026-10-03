"use client";

/**
 * O seletor de organização do topo, com o módulo clínica: uma clínica, uma organização.
 *
 * O `TenantSwitcher` do núcleo já some para quem tem uma organização só, MENOS para o
 * administrador da instalação, que sempre o vê por causa do "Gerenciar organizações". Numa
 * instalação de uma clínica só, esse dono é quem mais usa o dia a dia, e o seletor vira um
 * botão com um item só, que leva ao cadastro de outras organizações que a clínica não tem.
 *
 * Por isso o seletor sai também para ele quando a organização é uma clínica: o módulo está
 * instalado e há alguém ativo na equipe de saúde (`GET /api/v1/clinica/profissionais`, que
 * responde 409 sem o módulo). O recurso continua no núcleo: quem tem duas organizações vê o
 * seletor, o acompanhamento de suporte continua mostrando a organização acompanhada, e o
 * administrador da instalação segue chegando às organizações pelo modo administrador do menu
 * do usuário.
 */
import { useQuery } from "@tanstack/react-query";

import { TenantSwitcher } from "@/components/shell/TenantSwitcher";
import { useUser } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";

export function SeletorDeOrganizacao() {
  const user = useUser();
  const soOAdministradorVeria =
    user.organizations.length <= 1 && user.is_platform_admin && !user.support;
  // A mesma chave da visão Equipe e das configurações da clínica, para dividir o cache.
  const { data, isPending, isError } = useQuery({
    queryKey: ["clinica", "profissionais"],
    queryFn: async () =>
      (await apiClient.get<{ data: Array<{ ativo: boolean }> }>("/api/v1/clinica/profissionais"))
        .data,
    enabled: soOAdministradorVeria,
    staleTime: 60_000,
    retry: false,
  });

  if (!soOAdministradorVeria) return <TenantSwitcher />;
  // Carregando, nada; sem o módulo (409) ou sem equipe, o comportamento do núcleo.
  if (isPending) return null;
  if (!isError && data?.some((p) => p.ativo)) return null;
  return <TenantSwitcher />;
}
