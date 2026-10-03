"use client";

/**
 * AGENDAR em três toques: quem, o quê (já com o profissional) e quando. A rota é a mesma da
 * interface atual (`POST /api/v1/agenda/agendamentos`), com chave de idempotência por abertura,
 * para o clique duplo não marcar duas vezes.
 */
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { randomId } from "@/lib/random-id";

import { useNovo } from "./Casca";
import {
  mensagemDoErro,
  useBuscaDePacientes,
  useHorariosLivresDaFolha,
  useRecarregar,
  useTiposDeAtendimento,
  type ProfissionalDaGrade,
} from "./dados";
import { Avatar, Folha, PontoDaModalidade, dataLonga, hora, primeiroNome } from "./pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

export interface PacienteEscolhido {
  id: string;
  nome: string;
}

export function FolhaAgendar({
  aberta,
  aoFechar,
  profissionais,
  pacienteInicial,
}: {
  aberta: boolean;
  aoFechar: () => void;
  profissionais: ProfissionalDaGrade[];
  pacienteInicial?: PacienteEscolhido | null;
}) {
  return aberta ? (
    <Conteudo
      aoFechar={aoFechar}
      profissionais={profissionais}
      pacienteInicial={pacienteInicial ?? null}
    />
  ) : null;
}

function Conteudo({
  aoFechar,
  profissionais,
  pacienteInicial,
}: {
  aoFechar: () => void;
  profissionais: ProfissionalDaGrade[];
  pacienteInicial: PacienteEscolhido | null;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso, meuId, soAsMinhas, modalidades } = useNovo();
  const recarregar = useRecarregar();
  const [chave] = React.useState(() => randomId());
  const [paciente, setPaciente] = React.useState<PacienteEscolhido | null>(pacienteInicial);
  const [busca, setBusca] = React.useState("");
  const pacientes = useBuscaDePacientes(busca);
  const tipos = useTiposDeAtendimento();
  const tiposDaVisao = (tipos.data ?? []).filter(
    (t) => t.modalidade && (!modalidades || modalidades.includes(t.modalidade)),
  );
  const [tipoId, setTipoId] = React.useState<string | null>(null);
  const tipo = tiposDaVisao.find((t) => t.event_type_id === tipoId) ?? null;
  const quemAtende = profissionais.filter(
    (p) => !tipo?.modalidade || p.modalidades.includes(tipo.modalidade),
  );
  const [donoEscolhido, setDono] = React.useState<string | null>(soAsMinhas ? meuId : null);
  const dono = quemAtende.some((p) => p.user_id === donoEscolhido)
    ? donoEscolhido
    : (quemAtende[0]?.user_id ?? null);

  const dias = React.useMemo(() => {
    const hoje = partesNoFuso(new Date(), fuso);
    return Array.from({ length: 21 }, (_, i) => {
      const d = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + i, 12));
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
    });
  }, [fuso]);
  const [indice, setIndice] = React.useState(0);
  const [slot, setSlot] = React.useState<string | null>(null);
  const dia = dias[indice]!;
  const seguinte = new Date(Date.UTC(dia.ano, dia.mes - 1, dia.dia + 1, 12));
  const filtro =
    tipo && dono
      ? {
          event_type_id: tipo.event_type_id,
          owner_user_id: dono,
          de: instanteDe({ ...dia }, fuso).toISOString(),
          ate: instanteDe(
            {
              ano: seguinte.getUTCFullYear(),
              mes: seguinte.getUTCMonth() + 1,
              dia: seguinte.getUTCDate(),
            },
            fuso,
          ).toISOString(),
        }
      : null;
  const livres = useHorariosLivresDaFolha(filtro);
  const [agora] = React.useState(() => Date.now());
  const slots = (livres.data?.slots ?? []).filter((s) => new Date(s.inicio).getTime() > agora);

  const marcar = useMutation({
    mutationFn: async () =>
      apiClient.post(
        "/api/v1/agenda/agendamentos",
        {
          event_type_id: tipo!.event_type_id,
          starts_at: slot,
          owner_user_id: dono,
          contact_id: paciente!.id,
        },
        { idempotencyKey: chave },
      ),
    onSuccess: () => {
      toast.success(
        `${primeiroNome(paciente!.nome)} agendado para ${dataLonga(slot!, fuso, tag)}, ${hora(slot!, fuso)}.`,
      );
      recarregar();
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Folha aberta aoFechar={aoFechar} titulo="Agendar" testid="novo-folha-agendar">
      <div className="grid gap-6">
        {/* 1. Quem */}
        <div>
          <p className="n-rotulo">Paciente</p>
          {paciente ? (
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--n-papel)] p-3">
              <Avatar nome={paciente.nome} tamanho={36} />
              <span className="flex-1 font-semibold">{paciente.nome}</span>
              <button
                type="button"
                className="n-botao n-botao-suave n-botao-pequeno"
                onClick={() => setPaciente(null)}
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                className="n-campo"
                placeholder="Nome ou telefone"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                autoFocus
                aria-label="Buscar paciente"
              />
              <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto">
                {(pacientes.data ?? []).slice(0, 8).map((c) => {
                  const nome = rotuloDoContato(c, t);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="n-linha-clicavel items-center gap-3 px-2 py-2"
                      onClick={() => setPaciente({ id: c.id, nome })}
                    >
                      <Avatar nome={nome} tamanho={30} />
                      <span className="flex-1 truncate text-sm font-semibold">{nome}</span>
                      <span className="n-fraco text-xs">{c.phone_number}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 2. O quê e com quem */}
        <div>
          <p className="n-rotulo">Atendimento</p>
          <div className="flex flex-wrap gap-2">
            {tiposDaVisao.map((t) => (
              <button
                key={t.event_type_id}
                type="button"
                className="n-chip"
                aria-pressed={t.event_type_id === tipoId}
                onClick={() => {
                  setTipoId(t.event_type_id);
                  setSlot(null);
                }}
              >
                <PontoDaModalidade modalidade={t.modalidade} />
                {t.nome}
              </button>
            ))}
            {tipos.isSuccess && tiposDaVisao.length === 0 && (
              <p className="n-suave text-sm">
                {t(
                  "Nenhum tipo de atendimento com modalidade. O administrador marca em Configurações › Regras da clínica.",
                )}
              </p>
            )}
          </div>
          {tipo && quemAtende.length > 1 && !soAsMinhas && (
            <div className="mt-3 flex flex-wrap gap-2">
              {quemAtende.map((p) => (
                <button
                  key={p.user_id}
                  type="button"
                  className="n-chip"
                  aria-pressed={p.user_id === dono}
                  onClick={() => {
                    setDono(p.user_id);
                    setSlot(null);
                  }}
                >
                  <Avatar nome={p.nome} tamanho={20} />
                  {p.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Quando */}
        {tipo && dono && (
          <div>
            <p className="n-rotulo">{t("Quando")}</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
              {dias.map((d, i) => {
                const data = new Date(Date.UTC(d.ano, d.mes - 1, d.dia, 12));
                return (
                  <button
                    key={`${d.mes}-${d.dia}`}
                    type="button"
                    aria-pressed={i === indice}
                    onClick={() => {
                      setIndice(i);
                      setSlot(null);
                    }}
                    className={`flex min-w-[56px] flex-col items-center rounded-2xl px-2 py-2 text-xs font-semibold ${
                      i === indice
                        ? "bg-[var(--n-tinta)] text-[var(--n-papel)]"
                        : "bg-[var(--n-papel)]"
                    }`}
                  >
                    <span className="n-inicial opacity-75">
                      {i === 0
                        ? "Hoje"
                        : new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" })
                            .format(data)
                            .replace(".", "")}
                    </span>
                    <span className="n-titulo n-numero text-xl">{d.dia}</span>
                  </button>
                );
              })}
            </div>
            {livres.isLoading ? (
              <p className="n-fraco text-sm">{t("Procurando horários…")}</p>
            ) : livres.isError ? (
              <p
                className="rounded-2xl bg-[var(--n-aviso-suave)] p-3 text-sm text-[var(--n-aviso)]"
                role="status"
              >
                {mensagemDoErro(livres.error)}
              </p>
            ) : slots.length === 0 ? (
              <p className="n-suave text-sm">{t("Nenhum horário livre neste dia.")}</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.inicio}
                    type="button"
                    aria-pressed={slot === s.inicio}
                    onClick={() => setSlot(s.inicio)}
                    className={`n-numero rounded-xl py-2.5 text-sm font-semibold ${
                      slot === s.inicio
                        ? "bg-[var(--n-acao)] text-[var(--n-acao-tinta)]"
                        : "bg-[var(--n-papel)]"
                    }`}
                  >
                    {hora(s.inicio, fuso)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={!paciente || !tipo || !dono || !slot || marcar.isPending}
          onClick={() => marcar.mutate()}
        >
          {slot && paciente
            ? `Agendar ${primeiroNome(paciente.nome)} às ${hora(slot, fuso)}`
            : "Agendar"}
        </button>
      </div>
    </Folha>
  );
}
