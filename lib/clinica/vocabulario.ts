/**
 * O VOCABULÁRIO DO MÓDULO CLÍNICA — espelho dos CHECKs da migration 9001.
 *
 * O emissor usa estas constantes, nunca a string literal: é assim que um valor novo chega ao
 * banco e ao TypeScript no mesmo commit. O rótulo em pt-BR mora num `Record` à parte, cuja
 * exaustividade quem cobra é o compilador (mesmo padrão de `lib/agenda/tipos.ts`).
 */

export const MODALIDADES = ["fisioterapia", "pilates", "medicina", "enfermagem"] as const;
export type Modalidade = (typeof MODALIDADES)[number];

export const ROTULO_DA_MODALIDADE: Record<Modalidade, string> = {
  fisioterapia: "Fisioterapia",
  pilates: "Pilates",
  medicina: "Medicina",
  enfermagem: "Enfermagem",
};

export const TIPOS_DE_REGISTRO = ["anamnese", "avaliacao", "evolucao", "alta", "adendo"] as const;
export type TipoDeRegistro = (typeof TIPOS_DE_REGISTRO)[number];

export const ROTULO_DO_TIPO: Record<TipoDeRegistro, string> = {
  anamnese: "Anamnese",
  avaliacao: "Avaliação",
  evolucao: "Evolução",
  alta: "Alta",
  adendo: "Adendo",
};

export const CONSELHOS = ["CREFITO", "CRM", "COREN", "CREF", "CRN", "CRP", "outro"] as const;
export type Conselho = (typeof CONSELHOS)[number];

export const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

/** Um campo estruturado do modelo de registro de uma modalidade. */
export interface CampoDoModelo {
  chave: string;
  rotulo: string;
  tipo: "escala" | "numero" | "texto" | "texto_longo" | "opcoes" | "data";
  /** Sem ele preenchido o registro não é assinado (a rota recusa com 422). */
  obrigatorio?: boolean;
  /** Para `tipo: "opcoes"`: o valor gravado e o rótulo de cada opção. */
  opcoes?: readonly { valor: string; rotulo: string }[];
}

/**
 * Os modelos iniciais por modalidade. Ficam no código nesta entrega; a clínica poderá editá-los
 * pela tela quando houver a tabela de modelos. O conteúdo vai para `prontuario_registros.conteudo`
 * com estas chaves.
 */
export const MODELO_DA_MODALIDADE: Record<Modalidade, readonly CampoDoModelo[]> = {
  fisioterapia: [
    { chave: "queixa", rotulo: "Queixa principal", tipo: "texto" },
    { chave: "dor", rotulo: "Dor (0 a 10)", tipo: "escala" },
    { chave: "local_da_dor", rotulo: "Local da dor", tipo: "texto" },
    { chave: "amplitude", rotulo: "Amplitude de movimento", tipo: "texto" },
    { chave: "conduta", rotulo: "Conduta", tipo: "texto_longo" },
    { chave: "plano", rotulo: "Plano para a próxima sessão", tipo: "texto" },
  ],
  pilates: [
    { chave: "objetivo", rotulo: "Objetivo", tipo: "texto" },
    { chave: "restricoes", rotulo: "Restrições", tipo: "texto" },
    { chave: "aparelhos", rotulo: "Aparelhos usados", tipo: "texto" },
    { chave: "exercicios", rotulo: "Exercícios", tipo: "texto_longo" },
    { chave: "esforco", rotulo: "Percepção de esforço (0 a 10)", tipo: "escala" },
  ],
  medicina: [
    { chave: "queixa", rotulo: "Queixa principal", tipo: "texto" },
    { chave: "exame_fisico", rotulo: "Exame físico", tipo: "texto_longo" },
    { chave: "hipotese", rotulo: "Hipótese diagnóstica", tipo: "texto" },
    { chave: "conduta", rotulo: "Conduta", tipo: "texto_longo" },
    { chave: "prescricao", rotulo: "Prescrição", tipo: "texto_longo" },
  ],
  enfermagem: [
    { chave: "pressao", rotulo: "Pressão arterial", tipo: "texto" },
    { chave: "frequencia_cardiaca", rotulo: "Frequência cardíaca (bpm)", tipo: "numero" },
    { chave: "saturacao", rotulo: "Saturação (%)", tipo: "numero" },
    { chave: "temperatura", rotulo: "Temperatura (°C)", tipo: "numero" },
    { chave: "glicemia", rotulo: "Glicemia capilar (mg/dL)", tipo: "numero" },
    { chave: "procedimento", rotulo: "Procedimento realizado", tipo: "texto_longo" },
  ],
};

/** Motivo da alta. "Abandono" é o indicador de saúde mais importante da clínica. */
export const MOTIVOS_DE_ALTA = [
  { valor: "objetivo_atingido", rotulo: "Objetivo atingido" },
  { valor: "encaminhado", rotulo: "Encaminhado" },
  { valor: "abandono", rotulo: "Abandono" },
  { valor: "a_pedido", rotulo: "A pedido do paciente" },
] as const;

/**
 * Avaliação de fisioterapia com o conteúdo mínimo da Resolução COFFITO 414/2012: história
 * clínica, exame físico e funcional, exames complementares, diagnóstico e prognóstico
 * fisioterapêuticos e plano terapêutico (objetivos, condutas, número de sessões e frequência).
 */
const AVALIACAO_DE_FISIOTERAPIA: readonly CampoDoModelo[] = [
  { chave: "queixa", rotulo: "Queixa principal", tipo: "texto" },
  { chave: "historia_clinica", rotulo: "História clínica", tipo: "texto_longo" },
  { chave: "dor", rotulo: "Dor (0 a 10)", tipo: "escala" },
  { chave: "exame_fisico_funcional", rotulo: "Exame físico e funcional", tipo: "texto_longo" },
  { chave: "exames_complementares", rotulo: "Exames complementares", tipo: "texto_longo" },
  {
    chave: "diagnostico_fisioterapeutico",
    rotulo: "Diagnóstico fisioterapêutico",
    tipo: "texto_longo",
    obrigatorio: true,
  },
  { chave: "prognostico", rotulo: "Prognóstico", tipo: "texto", obrigatorio: true },
  { chave: "objetivos", rotulo: "Objetivos do tratamento", tipo: "texto_longo", obrigatorio: true },
  { chave: "condutas_previstas", rotulo: "Condutas previstas", tipo: "texto_longo" },
  { chave: "numero_de_sessoes", rotulo: "Número de sessões previsto", tipo: "numero" },
  { chave: "frequencia_semanal", rotulo: "Frequência semanal", tipo: "numero" },
];

/**
 * O plano da avaliação: o que vira o plano de tratamento que a recepção também vê (migration
 * 9006). As chaves são lidas pelo gatilho `fn_clinica_plano_do_registro`; trocar uma aqui pede a
 * mesma troca lá. A data da reavaliação é decidida pelo avaliador, e o retorno já fica marcado
 * com ele nesse dia (`lib/clinica/retorno-agendado.ts`).
 */
export const CAMPO_DATA_DA_REAVALIACAO: CampoDoModelo = {
  chave: "data_reavaliacao",
  rotulo: "Data da reavaliação",
  tipo: "data",
};

const PLANO_DA_AVALIACAO: readonly CampoDoModelo[] = [
  { chave: "numero_de_sessoes", rotulo: "Número de sessões previsto", tipo: "numero" },
  { chave: "frequencia_semanal", rotulo: "Frequência semanal", tipo: "numero" },
  CAMPO_DATA_DA_REAVALIACAO,
];

const AVALIACAO_MEDICA: readonly CampoDoModelo[] = [
  { chave: "queixa", rotulo: "Queixa principal", tipo: "texto" },
  { chave: "hda", rotulo: "História da doença atual", tipo: "texto_longo" },
  { chave: "exame_fisico", rotulo: "Exame físico", tipo: "texto_longo" },
  { chave: "hipotese", rotulo: "Hipótese diagnóstica", tipo: "texto" },
  { chave: "cid", rotulo: "CID (opcional)", tipo: "texto" },
  { chave: "conduta", rotulo: "Conduta", tipo: "texto_longo" },
  { chave: "prescricao", rotulo: "Prescrição", tipo: "texto_longo" },
];

const ALTA: readonly CampoDoModelo[] = [
  {
    chave: "motivo",
    rotulo: "Motivo da alta",
    tipo: "opcoes",
    obrigatorio: true,
    opcoes: MOTIVOS_DE_ALTA,
  },
  { chave: "resumo", rotulo: "Resumo do tratamento", tipo: "texto_longo", obrigatorio: true },
];

/**
 * Os campos de um registro, por modalidade E tipo. A evolução de sessão continua curta (o modelo
 * da modalidade); avaliação e anamnese ganham o conteúdo que o conselho exige; alta é igual em
 * todas as modalidades. Adendo não tem campos: é texto ligado ao original.
 */
export function modeloDoRegistro(
  modalidade: Modalidade,
  tipo: TipoDeRegistro,
): readonly CampoDoModelo[] {
  if (tipo === "adendo") return [];
  if (tipo === "alta") return ALTA;
  if (tipo === "anamnese") {
    if (modalidade === "fisioterapia") return AVALIACAO_DE_FISIOTERAPIA;
    if (modalidade === "medicina") return AVALIACAO_MEDICA;
  }
  if (tipo === "avaliacao") {
    // A fisioterapia já pede sessões e frequência (COFFITO 414/2012); ganha só a data.
    if (modalidade === "fisioterapia")
      return [...AVALIACAO_DE_FISIOTERAPIA, CAMPO_DATA_DA_REAVALIACAO];
    if (modalidade === "medicina") return [...AVALIACAO_MEDICA, ...PLANO_DA_AVALIACAO];
    return [...MODELO_DA_MODALIDADE[modalidade], ...PLANO_DA_AVALIACAO];
  }
  return MODELO_DA_MODALIDADE[modalidade];
}

/**
 * Os campos a MOSTRAR de um registro já assinado: os do modelo do tipo e, depois, os da
 * modalidade que ainda não apareceram. Registros assinados antes de os modelos se separarem por
 * tipo usavam as chaves da modalidade, e não podem sumir da tela.
 */
export function camposParaMostrar(
  modalidade: Modalidade,
  tipo: TipoDeRegistro,
): readonly CampoDoModelo[] {
  const doTipo = modeloDoRegistro(modalidade, tipo);
  const vistas = new Set(doTipo.map((c) => c.chave));
  return [...doTipo, ...MODELO_DA_MODALIDADE[modalidade].filter((c) => !vistas.has(c.chave))];
}

/** Data de calendário `AAAA-MM-DD` que existe (31/02 não passa). */
export function ehDataValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** O que falta preencher para assinar: rótulos dos obrigatórios vazios ou opção inválida. */
export function camposObrigatoriosFaltando(
  modalidade: Modalidade,
  tipo: TipoDeRegistro,
  conteudo: Record<string, string | number>,
): string[] {
  return modeloDoRegistro(modalidade, tipo)
    .filter((c) => {
      const v = conteudo[c.chave];
      const vazio = v === undefined || (typeof v === "string" && v.trim() === "");
      if (c.tipo === "opcoes" && !vazio) return !c.opcoes?.some((o) => o.valor === v);
      if (c.tipo === "data" && !vazio) return !ehDataValida(v);
      return Boolean(c.obrigatorio) && vazio;
    })
    .map((c) => c.rotulo);
}

/** O valor como aparece para quem lê: opção vira o rótulo dela; o resto, o texto gravado. */
export function valorParaMostrar(c: CampoDoModelo, v: string | number): string {
  if (c.tipo === "data" && ehDataValida(v)) return v.split("-").reverse().join("/");
  return c.opcoes?.find((o) => o.valor === v)?.rotulo ?? String(v);
}
