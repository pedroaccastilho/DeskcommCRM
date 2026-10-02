/**
 * Clínica (prontuário e agenda) — módulo oficial via ADR-0002 (migrations 9001 a 9003, fork TOQ).
 *
 * `protecaoPropria` em todas: a RLS do prontuário é por PROFISSIONAL (não por papel
 * nem por membro), e a da agenda separa leitura (membro, ou só `admin` no preço) de escrita
 * (`admin` ou só o servidor). As duas são ligadas dentro da provisionadora, então a policy ampla automática não
 * pode nascer nelas.
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "clinica",
  tabelas: [
    "clinica_profissionais",
    "prontuario_registros",
    "prontuario_acessos",
    // A agenda da clínica (migration 9002), pela provisionadora auxiliar.
    "clinica_politicas",
    "clinica_tipos_atendimento",
    "clinica_agenda_historico",
    "clinica_multas",
    // O preço da sessão, só do administrador (migration 9003).
    "clinica_precos",
  ],
  protecaoPropria: [
    "clinica_profissionais",
    "prontuario_registros",
    "prontuario_acessos",
    "clinica_politicas",
    "clinica_tipos_atendimento",
    "clinica_agenda_historico",
    "clinica_multas",
    "clinica_precos",
  ],
});
