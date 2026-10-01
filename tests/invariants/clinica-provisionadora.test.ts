/**
 * Clínica (prontuário) — módulo oficial via ADR-0002 (migration 9001, fork TOQ).
 *
 * `protecaoPropria` nas três tabelas: a RLS do prontuário é por PROFISSIONAL (não por papel
 * nem por membro), ligada dentro da própria provisionadora, então a policy ampla automática
 * não pode nascer nelas.
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "clinica",
  tabelas: ["clinica_profissionais", "prontuario_registros", "prontuario_acessos"],
  protecaoPropria: ["clinica_profissionais", "prontuario_registros", "prontuario_acessos"],
});
