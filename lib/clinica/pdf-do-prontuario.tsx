/**
 * O PRONTUÁRIO EM PDF — módulo clínica (fork TOQ, entrega 5 do plano do prontuário).
 *
 * Serve para entregar uma cópia ao paciente (direito de acesso) ou a outro profissional
 * (encaminhamento). O documento é uma CÓPIA dos registros assinados: a prova continua sendo o
 * registro no banco, imutável e com a assinatura carimbada pelo gatilho da migration 9001.
 * Por isso o PDF imprime quem assinou e quando, exatamente como o banco carimbou, e nunca
 * recalcula nada disso.
 *
 * Sem marca, como o PDF de LGPD (`lib/lgpd/pdf-renderer.tsx`): quem responde pelo prontuário é a
 * clínica, e o rodapé nomeia a razão social dela. O texto é pt-BR fixo, como o de LGPD: é um
 * documento clínico brasileiro.
 *
 * O renderizador não consulta o banco. Quem monta a entrada é a rota, pelo client de sessão.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import {
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposParaMostrar,
  valorParaMostrar,
  type Modalidade,
  type TipoDeRegistro,
} from "./vocabulario";

export interface RegistroParaPdf {
  id: string;
  modalidade: Modalidade;
  tipo: TipoDeRegistro;
  appointment_id: string | null;
  adendo_de: string | null;
  conteudo: Record<string, string | number>;
  texto: string | null;
  autor_nome: string;
  autor_registro: string;
  assinado_em: string;
}

export interface EntradaDoPdfDoProntuario {
  clinica: string;
  paciente: { nome: string; telefone: string | null };
  /** Quem gerou a cópia: vai impresso, porque a cópia também é um acesso. */
  geradoPor: string;
  geradoEm: Date;
  registros: RegistroParaPdf[];
}

/** Um registro como o documento o imprime: rótulos resolvidos, campos vazios fora. */
export interface RegistroImpresso {
  titulo: string;
  data: string;
  adendoDe: string | null;
  sessaoDaAgenda: boolean;
  campos: { rotulo: string; valor: string }[];
  texto: string | null;
  assinatura: string;
}

const FUSO = "America/Sao_Paulo";

export function dataHora(iso: string | Date): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Os registros na ordem em que aconteceram (o mais antigo primeiro, como se lê um prontuário de
 * papel), cada um já com o texto que vai impresso.
 */
export function registrosParaImprimir(registros: RegistroParaPdf[]): RegistroImpresso[] {
  const porId = new Map(registros.map((r) => [r.id, r]));
  return [...registros]
    .sort((a, b) => a.assinado_em.localeCompare(b.assinado_em))
    .map((r) => {
      const original = r.adendo_de ? porId.get(r.adendo_de) : undefined;
      return {
        titulo: `${ROTULO_DA_MODALIDADE[r.modalidade]} · ${ROTULO_DO_TIPO[r.tipo]}`,
        data: dataHora(r.assinado_em),
        adendoDe: r.adendo_de
          ? original
            ? `${ROTULO_DO_TIPO[original.tipo]} de ${dataHora(original.assinado_em)}`
            : "registro anterior"
          : null,
        sessaoDaAgenda: Boolean(r.appointment_id),
        campos: camposParaMostrar(r.modalidade, r.tipo)
          .filter((c) => r.conteudo[c.chave] !== undefined && r.conteudo[c.chave] !== "")
          .map((c) => ({ rotulo: c.rotulo, valor: valorParaMostrar(c, r.conteudo[c.chave]!) })),
        texto: r.texto,
        assinatura: `Assinado eletronicamente por ${r.autor_nome} · ${r.autor_registro} em ${dataHora(r.assinado_em)}`,
      };
    });
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 56,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1f2937",
  },
  header: { borderBottom: "1pt solid #d1d5db", paddingBottom: 8, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 90, color: "#6b7280" },
  value: { flex: 1 },
  registro: {
    marginBottom: 10,
    padding: 8,
    border: "0.5pt solid #e5e7eb",
    borderRadius: 3,
  },
  registroTitulo: { fontSize: 11, fontWeight: "bold" },
  registroSub: { fontSize: 8, color: "#6b7280", marginTop: 2 },
  campo: { marginTop: 5 },
  campoRotulo: { fontSize: 8, color: "#6b7280", textTransform: "uppercase" },
  assinatura: {
    marginTop: 6,
    paddingTop: 4,
    borderTop: "0.5pt solid #e5e7eb",
    fontSize: 8,
    color: "#4b5563",
  },
  vazio: { color: "#6b7280", marginTop: 8 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#9ca3af",
    borderTop: "0.5pt solid #e5e7eb",
    paddingTop: 4,
  },
});

export function ProntuarioPdf({ d }: { d: EntradaDoPdfDoProntuario }): React.ReactElement {
  const impressos = registrosParaImprimir(d.registros);
  return (
    <Document title={`Prontuário · ${d.paciente.nome}`} author={d.clinica}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Prontuário do paciente</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Paciente</Text>
            <Text style={styles.value}>{d.paciente.nome}</Text>
          </View>
          {d.paciente.telefone ? (
            <View style={styles.row}>
              <Text style={styles.label}>Telefone</Text>
              <Text style={styles.value}>{d.paciente.telefone}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Clínica</Text>
            <Text style={styles.value}>{d.clinica}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Cópia gerada</Text>
            <Text style={styles.value}>
              {dataHora(d.geradoEm)} por {d.geradoPor}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Registros</Text>
            <Text style={styles.value}>{impressos.length}</Text>
          </View>
        </View>

        {impressos.length === 0 ? (
          <Text style={styles.vazio}>Nenhum registro no prontuário deste paciente.</Text>
        ) : (
          impressos.map((r, i) => (
            <View key={i} style={styles.registro} wrap={false}>
              <Text style={styles.registroTitulo}>{r.titulo}</Text>
              <Text style={styles.registroSub}>
                {r.data}
                {r.sessaoDaAgenda ? " · Sessão da agenda" : ""}
                {r.adendoDe ? ` · Adendo a: ${r.adendoDe}` : ""}
              </Text>
              {r.campos.map((c) => (
                <View key={c.rotulo} style={styles.campo}>
                  <Text style={styles.campoRotulo}>{c.rotulo}</Text>
                  <Text>{c.valor}</Text>
                </View>
              ))}
              {r.texto ? (
                <View style={styles.campo}>
                  <Text>{r.texto}</Text>
                </View>
              ) : null}
              <Text style={styles.assinatura}>{r.assinatura}</Text>
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>
            Documento sigiloso com dados de saúde de {d.paciente.nome}. Cópia dos registros
            assinados no sistema de {d.clinica}: o registro assinado não se altera, e correções
            aparecem como adendo.
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderProntuarioPdf(d: EntradaDoPdfDoProntuario): Promise<Buffer> {
  const buf = await renderToBuffer(<ProntuarioPdf d={d} />);
  return buf as Buffer;
}
