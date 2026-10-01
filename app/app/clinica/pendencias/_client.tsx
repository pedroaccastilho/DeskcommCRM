"use client";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useClinicaEu, usePendencias } from "@/components/clinica/ProntuarioDoPaciente";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { ApiError } from "@/lib/api/types";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

export function EvolucoesPendentes() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const eu = useClinicaEu();
  const profissional = eu.data?.profissional ?? null;
  const pendencias = usePendencias(Boolean(profissional));

  if (eu.isLoading) return null;
  if (!profissional) {
    return (
      <Card className="p-4 text-sm text-text-muted" role="status">
        {t(
          "O prontuário só é visível para profissionais de saúde cadastrados e ativos na clínica. O cadastro fica em Configurações › Profissionais de saúde.",
        )}
      </Card>
    );
  }
  if (pendencias.error instanceof ApiError) {
    return <Card className="text-danger p-4 text-sm">{pendencias.error.message}</Card>;
  }
  if (pendencias.isLoading) return null;

  const lista = pendencias.data ?? [];
  if (lista.length === 0) {
    return (
      <Card className="p-4 text-sm text-text-muted" data-testid="pendencias-vazio">
        {t("Nenhuma evolução pendente. Tudo registrado.")}
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="pendencias-lista">
      {lista.map((p) => (
        <li key={p.appointment_id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {rotuloDoContato(p.contato, t)}
                </span>
                {p.atrasada ? (
                  <Badge variant="warning" data-testid={`atrasada-${p.appointment_id}`}>
                    {t("Atrasada")}
                  </Badge>
                ) : null}
              </div>
              <div className="truncate text-xs text-text-muted">
                {new Date(p.comeca).toLocaleString(tagDoIdioma)} · {p.titulo}
              </div>
            </div>
            <Button asChild size="sm">
              <Link
                href={`/app/contacts/${p.contact_id}?aba=prontuario&sessao=${p.appointment_id}`}
                data-testid={`registrar-evolucao-${p.appointment_id}`}
              >
                {t("Registrar evolução")}
              </Link>
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
