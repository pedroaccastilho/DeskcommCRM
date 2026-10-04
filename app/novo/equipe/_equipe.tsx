"use client";

/**
 * EQUIPE: quem trabalha na clínica e os perfis de cada um (migration 9008).
 *
 * Só o administrador cadastra (Pedro, 2026-10-04). Cada pessoa pode somar perfis, e o acesso é a
 * soma: escolher "Médico" já dá o que um médico vê e faz, e pede o registro no conselho na mesma
 * folha. Substitui, na interface nova, a tela antiga Configurações › Profissionais de saúde.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useNovo } from "@/components/novo/Casca";
import { mensagemDoErro, useRecarregar } from "@/components/novo/dados";
import { Avatar, Carregando, Folha, Secao, Vazio } from "@/components/novo/pecas";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import {
  CARGOS,
  ROTULO_DO_CARGO_DO_USUARIO,
  SAUDE_DO_CARGO,
  cargoDeSaudeDe,
  problemaNosCargos,
  type CargoDoUsuario,
} from "@/lib/clinica/cargos";
import { UFS } from "@/lib/clinica/vocabulario";
import { useT } from "@/lib/i18n/IdiomaProvider";

interface Membro {
  user_id: string;
  nome: string;
  email: string | null;
  role: string;
  cargos: CargoDoUsuario[];
  profissional: {
    nome_profissional: string;
    conselho: string;
    registro_numero: string;
    registro_uf: string;
    ativo: boolean;
  } | null;
  sou_eu: boolean;
}

interface ConvitePendente {
  id: string;
  email: string;
  cargos: CargoDoUsuario[];
  nome_profissional: string | null;
  expirado: boolean;
  email_dispatched: boolean;
  accept_url: string | null;
}

interface DadosDaEquipe {
  membros: Membro[];
  convites: ConvitePendente[];
}

const DESCRICAO: Record<CargoDoUsuario, string> = {
  administrador: "Vê e configura tudo, cadastra a equipe.",
  gerente: "Relatórios e painéis de como a clínica está andando.",
  financeiro: "Pagamentos, pacotes, multas e relatórios financeiros.",
  juridico: "LGPD, auditoria e quem abriu cada prontuário, sem o conteúdo clínico.",
  recepcao: "Balcão, agenda, WhatsApp e cadastro de pacientes.",
  medico: "Atende, lê o prontuário e assina em medicina (CRM).",
  fisioterapeuta: "Atende, lê o prontuário e assina em fisioterapia e pilates (CREFITO).",
  enfermeiro: "Atende, lê o prontuário e assina em enfermagem (COREN).",
  educador: "Dá aulas de pilates e assina as próprias evoluções (CREF).",
};

function useEquipe(habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "equipe"],
    queryFn: async () =>
      (await apiClient.get<{ data: DadosDaEquipe }>("/api/v1/clinica/equipe")).data,
    enabled: habilitado,
    retry: false,
  });
}

export function Equipe() {
  const t = useT();
  const { role } = useNovo();
  const ehAdmin = role === "admin";
  const equipe = useEquipe(ehAdmin);
  const [editando, setEditando] = React.useState<Membro | null>(null);
  const [convidando, setConvidando] = React.useState(false);

  if (!ehAdmin) {
    return (
      <div className="n-conteudo max-w-3xl">
        <Vazio
          titulo="Só o administrador cadastra a equipe"
          texto="Peça ao administrador da clínica para incluir alguém ou trocar um perfil."
        />
      </div>
    );
  }

  return (
    <div className="n-conteudo max-w-3xl" data-testid="novo-equipe">
      <div className="n-entra flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">Equipe</h1>
          <p className="n-suave mt-1">
            {t("Cada pessoa pode ter mais de um perfil. O acesso é a soma de todos.")}
          </p>
        </div>
        <button
          type="button"
          className="n-botao n-botao-escuro"
          onClick={() => setConvidando(true)}
          data-testid="novo-equipe-cadastrar"
        >
          Cadastrar pessoa
        </button>
      </div>

      <div className="mt-8 grid gap-8">
        {equipe.isLoading ? (
          <Carregando linhas={4} />
        ) : equipe.error ? (
          <Vazio titulo="Não deu para abrir a equipe" texto={mensagemDoErro(equipe.error)} />
        ) : (
          <>
            <Secao titulo="Na equipe" contagem={equipe.data?.membros.length}>
              <ul className="n-cartao grid gap-0.5 p-2">
                {(equipe.data?.membros ?? []).map((m) => (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      className="n-linha-clicavel w-full items-center gap-4 px-3 py-3 text-left"
                      onClick={() => setEditando(m)}
                      data-testid="novo-equipe-membro"
                    >
                      <Avatar nome={m.nome} tamanho={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {m.nome}
                          {m.sou_eu && <span className="n-fraco font-normal"> ({t("você")})</span>}
                        </span>
                        <span className="n-suave block truncate text-sm">{m.email ?? ""}</span>
                        <SelosDosCargos cargos={m.cargos} />
                      </span>
                      <span className="n-fraco">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Secao>

            {(equipe.data?.convites ?? []).length > 0 && (
              <Secao
                titulo="Convidados, ainda não entraram"
                contagem={equipe.data?.convites.length}
              >
                <ul className="n-cartao grid gap-0.5 p-2">
                  {(equipe.data?.convites ?? []).map((c) => (
                    <li key={c.id} className="flex items-center gap-4 px-3 py-3">
                      <Avatar nome={c.nome_profissional ?? c.email} tamanho={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {c.nome_profissional ?? c.email}
                        </span>
                        <span className="n-suave block truncate text-sm">
                          {c.expirado ? "Convite vencido" : c.email}
                        </span>
                        <SelosDosCargos cargos={c.cargos} />
                      </span>
                      {c.accept_url && <BotaoCopiarLink link={c.accept_url} />}
                    </li>
                  ))}
                </ul>
              </Secao>
            )}
          </>
        )}
      </div>

      {editando && <FolhaDosPerfis membro={editando} aoFechar={() => setEditando(null)} />}
      {convidando && <FolhaDeCadastro aoFechar={() => setConvidando(false)} />}
    </div>
  );
}

function SelosDosCargos({ cargos }: { cargos: readonly CargoDoUsuario[] }) {
  const t = useT();
  if (cargos.length === 0) {
    return <span className="n-selo n-selo-aviso mt-1.5">{t("Sem perfil: escolha um")}</span>;
  }
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {cargos.map((c) => (
        <span key={c} className="n-selo n-selo-neutro">
          {ROTULO_DO_CARGO_DO_USUARIO[c]}
        </span>
      ))}
    </span>
  );
}

function BotaoCopiarLink({ link }: { link: string }) {
  return (
    <button
      type="button"
      className="n-botao n-botao-suave n-botao-pequeno"
      onClick={() => {
        void copyToClipboard(link).then((copiou) =>
          copiou
            ? toast.success("Link copiado. Mande para a pessoa pelo WhatsApp.")
            : toast.error("Não deu para copiar. Copie o link manualmente."),
        );
      }}
    >
      Copiar link
    </button>
  );
}

interface Registro {
  nome_profissional: string;
  registro_numero: string;
  registro_uf: string;
}

/** Os perfis como botões que ligam e desligam, e o registro do conselho quando há perfil de saúde. */
function EscolhaDePerfis({
  cargos,
  aoMudar,
  registro,
  aoMudarRegistro,
}: {
  cargos: CargoDoUsuario[];
  aoMudar: (c: CargoDoUsuario[]) => void;
  registro: Registro;
  aoMudarRegistro: (r: Registro) => void;
}) {
  const t = useT();
  const saude = cargoDeSaudeDe(cargos);
  const alternar = (c: CargoDoUsuario) => {
    if (cargos.includes(c)) return aoMudar(cargos.filter((x) => x !== c));
    // Um perfil de saúde só: escolher outro troca o anterior.
    const semOutraSaude = saude && c in SAUDE_DO_CARGO ? cargos.filter((x) => x !== saude) : cargos;
    aoMudar([...semOutraSaude, c]);
  };
  return (
    <div className="grid gap-6">
      <div>
        <p className="n-rotulo">Perfis</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CARGOS.map((c) => (
            <button
              key={c}
              type="button"
              className="n-chip !h-auto !justify-start !rounded-2xl !px-4 !py-3 text-left"
              aria-pressed={cargos.includes(c)}
              onClick={() => alternar(c)}
              data-testid={`novo-perfil-${c}`}
            >
              <span>
                <span className="block font-bold">{ROTULO_DO_CARGO_DO_USUARIO[c]}</span>
                <span className="block text-xs font-normal opacity-80">{DESCRICAO[c]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {saude && (
        <div className="grid gap-3">
          <p className="n-rotulo !mb-0">Registro no {SAUDE_DO_CARGO[saude].conselho}</p>
          <input
            className="n-campo"
            placeholder={t("Nome como está no conselho")}
            value={registro.nome_profissional}
            onChange={(e) => aoMudarRegistro({ ...registro, nome_profissional: e.target.value })}
            aria-label={t("Nome como está no conselho")}
          />
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <input
              className="n-campo"
              placeholder={t("Número do registro")}
              value={registro.registro_numero}
              onChange={(e) => aoMudarRegistro({ ...registro, registro_numero: e.target.value })}
              aria-label={t("Número do registro")}
            />
            <select
              className="n-campo"
              value={registro.registro_uf}
              onChange={(e) => aoMudarRegistro({ ...registro, registro_uf: e.target.value })}
              aria-label="UF do registro"
            >
              <option value="">UF</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function registroPreenchido(r: Registro): Partial<Registro> {
  return {
    ...(r.nome_profissional.trim() ? { nome_profissional: r.nome_profissional.trim() } : {}),
    ...(r.registro_numero.trim() ? { registro_numero: r.registro_numero.trim() } : {}),
    ...(r.registro_uf ? { registro_uf: r.registro_uf } : {}),
  };
}

function FolhaDosPerfis({ membro, aoFechar }: { membro: Membro; aoFechar: () => void }) {
  const t = useT();
  const recarregar = useRecarregar();
  const [cargos, setCargos] = React.useState<CargoDoUsuario[]>(membro.cargos);
  const [registro, setRegistro] = React.useState<Registro>({
    nome_profissional: membro.profissional?.nome_profissional ?? membro.nome,
    registro_numero: membro.profissional?.registro_numero ?? "",
    registro_uf: membro.profissional?.registro_uf ?? "",
  });
  const problema = problemaNosCargos(cargos);
  const salvar = useMutation({
    mutationFn: async () =>
      apiClient.put(`/api/v1/clinica/equipe/${membro.user_id}`, {
        cargos,
        ...registroPreenchido(registro),
      }),
    onSuccess: () => {
      toast.success(`Perfis de ${membro.nome} salvos.`);
      recarregar();
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });
  // "Entrar como": a tela inteira passa a ser a dessa pessoa, só para olhar (`lib/clinica/ver-como.ts`).
  const entrarComo = useMutation({
    mutationFn: async () =>
      apiClient.post("/api/v1/clinica/ver-como", { user_id: membro.user_id }),
    onSuccess: () => window.location.assign("/novo"),
    onError: (err) => showApiError(err),
  });
  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={membro.nome}
      subtitulo={membro.email ?? undefined}
      testid="novo-folha-perfis"
    >
      <EscolhaDePerfis
        cargos={cargos}
        aoMudar={setCargos}
        registro={registro}
        aoMudarRegistro={setRegistro}
      />
      {problema && <p className="n-suave mt-4 text-sm">{problema}</p>}
      <button
        type="button"
        className="n-botao n-botao-escuro mt-6 w-full"
        disabled={Boolean(problema) || salvar.isPending}
        onClick={() => salvar.mutate()}
        data-testid="novo-perfis-salvar"
      >
        {salvar.isPending ? "Salvando…" : "Salvar perfis"}
      </button>
      {!membro.sou_eu && (
        <div className="mt-6 border-t border-[var(--n-linha)] pt-4">
          <p className="n-suave text-sm">
            {t(
              "Veja o sistema do jeito que esta pessoa vê, para conferir. É só olhar: nada pode ser alterado nesse modo.",
            )}
          </p>
          <button
            type="button"
            className="n-botao n-botao-suave mt-3 w-full"
            disabled={entrarComo.isPending}
            onClick={() => entrarComo.mutate()}
            data-testid="novo-entrar-como"
          >
            {`${t("Entrar como")} ${membro.nome.split(" ")[0]}`}
          </button>
        </div>
      )}
    </Folha>
  );
}

function FolhaDeCadastro({ aoFechar }: { aoFechar: () => void }) {
  const t = useT();
  const recarregar = useRecarregar();
  const [email, setEmail] = React.useState("");
  const [cargos, setCargos] = React.useState<CargoDoUsuario[]>([]);
  const [registro, setRegistro] = React.useState<Registro>({
    nome_profissional: "",
    registro_numero: "",
    registro_uf: "",
  });
  const [link, setLink] = React.useState<{ url: string; saiu: boolean } | null>(null);
  const saude = cargoDeSaudeDe(cargos);
  const problema =
    problemaNosCargos(cargos) ??
    (saude && Object.keys(registroPreenchido(registro)).length < 3
      ? "Preencha o registro no conselho."
      : null);
  const cadastrar = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<{ data: { accept_url: string; email_dispatched: boolean } }>(
          "/api/v1/clinica/equipe/convites",
          { email: email.trim(), cargos, ...registroPreenchido(registro) },
        )
      ).data,
    onSuccess: (dados) => {
      recarregar();
      setLink({ url: dados.accept_url, saiu: dados.email_dispatched });
    },
    onError: (err) => showApiError(err),
  });

  if (link) {
    return (
      <Folha aberta aoFechar={aoFechar} titulo="Convite pronto" testid="novo-folha-cadastro">
        <p className="n-suave">
          {link.saiu
            ? `Mandamos o convite para ${email}. Se não chegar, mande este link pelo WhatsApp:`
            : t("O e-mail não está configurado. Mande este link para a pessoa pelo WhatsApp:")}
        </p>
        <p className="n-cartao mt-4 p-3 text-sm break-all" data-testid="novo-link-do-convite">
          {link.url}
        </p>
        <div className="mt-6 flex gap-3">
          <BotaoCopiarLink link={link.url} />
          <button type="button" className="n-botao n-botao-escuro flex-1" onClick={aoFechar}>
            Pronto
          </button>
        </div>
      </Folha>
    );
  }

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo="Cadastrar pessoa"
      subtitulo="A pessoa recebe um convite e entra já com os perfis escolhidos."
      testid="novo-folha-cadastro"
    >
      <div className="grid gap-6">
        <div>
          <p className="n-rotulo">E-mail</p>
          <input
            className="n-campo"
            type="email"
            placeholder="nome@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail"
            data-testid="novo-cadastro-email"
          />
        </div>
        <EscolhaDePerfis
          cargos={cargos}
          aoMudar={setCargos}
          registro={registro}
          aoMudarRegistro={setRegistro}
        />
      </div>
      {cargos.length > 0 && problema && <p className="n-suave mt-4 text-sm">{problema}</p>}
      <button
        type="button"
        className="n-botao n-botao-escuro mt-6 w-full"
        disabled={!email.includes("@") || Boolean(problema) || cadastrar.isPending}
        onClick={() => cadastrar.mutate()}
        data-testid="novo-cadastro-enviar"
      >
        {cadastrar.isPending ? "Enviando…" : "Enviar convite"}
      </button>
    </Folha>
  );
}
