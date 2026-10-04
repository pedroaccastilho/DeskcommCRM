/**
 * Clínica (prontuário, agenda, pacotes, origem do paciente e plano de tratamento) — módulo oficial via ADR-0002 (migrations 9001 a 9008, fork TOQ).
 *
 * `protecaoPropria` em todas: a RLS do prontuário é por PROFISSIONAL (não por papel
 * nem por membro), e a da agenda separa leitura (membro, ou `agent`+ na multa) de escrita
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
    // Os pacotes de sessões (migration 9004), chamados pela auxiliar da agenda.
    "clinica_produtos",
    "clinica_pacotes",
    "clinica_pacote_consumos",
    "clinica_pacote_eventos",
    // A origem do paciente (migration 9005), chamada pela provisionadora dos pacotes.
    "clinica_origens",
    "clinica_pacientes_origem",
    // O plano de tratamento (migration 9006), pela provisionadora auxiliar do plano.
    "clinica_planos_tratamento",
    // Os perfis de cada usuário (migration 9008), pela auxiliar das origens.
    "clinica_cargos_membro",
    "clinica_convites_cargos",
  ],
  protecaoPropria: [
    "clinica_profissionais",
    "prontuario_registros",
    "prontuario_acessos",
    "clinica_politicas",
    "clinica_tipos_atendimento",
    "clinica_agenda_historico",
    "clinica_multas",
    "clinica_produtos",
    "clinica_pacotes",
    "clinica_pacote_consumos",
    "clinica_pacote_eventos",
    "clinica_origens",
    "clinica_pacientes_origem",
    "clinica_planos_tratamento",
    "clinica_cargos_membro",
    "clinica_convites_cargos",
  ],
});
