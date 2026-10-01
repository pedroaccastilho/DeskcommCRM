/**
 * A IA NÃO LÊ PRONTUÁRIO (módulo clínica, migration 9001, fork TOQ).
 *
 * O motor do agente e o servidor MCP falam com o banco pelo service_role, que passa por fora
 * da RLS. Então "a IA não tem acesso ao prontuário" não é garantido pela policy: é garantido
 * por nenhuma ferramenta, worker ou montagem de contexto do agente citar as tabelas clínicas.
 * Esta catraca reprova o primeiro arquivo que citar.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ALCANCE_DA_IA = ["lib/mcp", "lib/agent-engine", "lib/ai", "workers"];
const TABELAS_CLINICAS = /\b(prontuario_registros|prontuario_acessos|clinica_profissionais)\b/;

function arquivos(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : arquivos(rel);
    return /\.(ts|tsx|js|mjs|md|sql)$/.test(e.name) ? [rel] : [];
  });
}

describe("a IA não alcança o prontuário", () => {
  const varridos = ALCANCE_DA_IA.flatMap(arquivos);

  it("a varredura enxerga o código da IA (sem isto o caso abaixo passaria por vazio)", () => {
    expect(varridos.length).toBeGreaterThan(100);
    expect(varridos.some((f) => f.startsWith("lib/mcp/tools/"))).toBe(true);
  });

  it("nenhum arquivo do alcance da IA cita tabela clínica", () => {
    const citam = varridos.filter((f) =>
      TABELAS_CLINICAS.test(fs.readFileSync(path.join(RAIZ, f), "utf8")),
    );
    expect(
      citam,
      "código da IA citando tabela do prontuário. O agente usa o service_role, que ignora a RLS: " +
        "se ele puder ler, lê tudo. Prontuário não vai para o WhatsApp nem para o contexto do modelo.",
    ).toEqual([]);
  });
});
