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
  tipo: "escala" | "numero" | "texto" | "texto_longo";
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
    { chave: "procedimento", rotulo: "Procedimento realizado", tipo: "texto_longo" },
  ],
};
