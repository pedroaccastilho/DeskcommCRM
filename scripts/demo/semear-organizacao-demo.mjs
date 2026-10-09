/**
 * Organização de DEMONSTRAÇÃO da TOQ na produção, para validar os perfis (Pedro, 2026-10-09).
 * TODOS OS DADOS SÃO FICTÍCIOS. Sem dependências: só Node 18+ (fetch).
 *
 * Lê NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do ambiente (nunca imprime a chave).
 * Ação em `DEMO_ACAO` ou como argumento:
 *   conferir  só lê: diz o que existe e o que seria criado (padrão)
 *   criar     cria a organização, os logins (um por perfil) e poucos dados fictícios
 *   apagar    apaga a organização de demonstração e os logins dela
 *
 * Guardas:
 *  - só escreve em linhas da organização de slug `toq-demonstracao`, criada aqui;
 *  - recusa se algum e-mail da demonstração já for membro de OUTRA organização;
 *  - não cria administrador da instalação (platform_admins), não manda e-mail nem WhatsApp:
 *    usuários nascem confirmados e os lembretes dos tipos de atendimento ficam desligados.
 *
 * Exemplo, na VPS, dentro do container do app (que já tem as variáveis):
 *   docker exec -i -e DEMO_ACAO=conferir <container-do-app> node --input-type=module - < semear-organizacao-demo.mjs
 */
const ACOES = ["conferir", "criar", "apagar"];
const ACAO = process.env.DEMO_ACAO ?? process.argv.find((a) => ACOES.includes(a)) ?? "conferir";
if (!ACOES.includes(ACAO)) throw new Error(`ação desconhecida: ${ACAO}`);

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !CHAVE) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente");

const SLUG = "toq-demonstracao";
const NOME_ORG = "TOQ Demonstração";
const SENHA = process.env.DEMO_SENHA ?? "Demo@TOQ2026!";
const DOMINIO = "toq-demo.example.com"; // example.com é reservado (RFC 2606): nunca entrega e-mail

const EQUIPE = [
  { chave: "admin", email: `administrador@${DOMINIO}`, nome: "Beatriz Lima (demo)", cargos: ["administrador"] },
  { chave: "gerente", email: `gerente@${DOMINIO}`, nome: "Gustavo Reis (demo)", cargos: ["gerente"] },
  { chave: "financeiro", email: `financeiro@${DOMINIO}`, nome: "Fernanda Lopes (demo)", cargos: ["financeiro"] },
  { chave: "juridico", email: `juridico@${DOMINIO}`, nome: "Jorge Almeida (demo)", cargos: ["juridico"] },
  { chave: "recepcao", email: `recepcao@${DOMINIO}`, nome: "Carla Souza (demo)", cargos: ["recepcao"] },
  { chave: "medico", email: `medico@${DOMINIO}`, nome: "Dra. Helena Prado (demo)", cargos: ["medico"], registro: "100001" },
  { chave: "fisio", email: `fisioterapeuta@${DOMINIO}`, nome: "Rafael Costa (demo)", cargos: ["fisioterapeuta"], registro: "200001-F" },
  { chave: "enfermeiro", email: `enfermeiro@${DOMINIO}`, nome: "Marcos Alves (demo)", cargos: ["enfermeiro"], registro: "300001" },
  { chave: "educador", email: `educador@${DOMINIO}`, nome: "Júlia Martins (demo)", cargos: ["educador"], registro: "000001-G" },
  // A soma de perfis: gerente que também atende como fisioterapeuta.
  { chave: "gerfisio", email: `gerente.fisio@${DOMINIO}`, nome: "Camila Rocha (demo)", cargos: ["gerente", "fisioterapeuta"], registro: "200002-F" },
];

// Espelho de lib/clinica/cargos.ts e lib/clinica/menus-por-cargo.ts (1.74.2).
const GESTAO = ["administrador", "gerente", "financeiro", "juridico"];
const SAUDE = {
  medico: { conselho: "CRM", modalidades: ["medicina"] },
  fisioterapeuta: { conselho: "CREFITO", modalidades: ["fisioterapia", "pilates"] },
  enfermeiro: { conselho: "COREN", modalidades: ["enfermagem"] },
  educador: { conselho: "CREF", modalidades: ["pilates"] },
};
const MENUS = {
  recepcao: ["/app/clinica/balcao", "/app/agenda", "/app/inbox", "/app/contacts", "/app/tasks"],
  saude: ["/app/clinica/meu-dia", "/app/agenda", "/app/clinica/pendencias", "/app/contacts", "/app/tasks"],
  educador: ["/app/clinica/meu-dia", "/app/agenda", "/app/contacts", "/app/tasks"],
};
const papelDos = (c) => (c.includes("administrador") ? "admin" : c.some((x) => GESTAO.includes(x)) ? "manager" : "agent");
function interfaceDos(cargos) {
  if (cargos.some((x) => GESTAO.includes(x))) return { preset: "completa" };
  const menus = new Set(cargos.map((c) => (c === "recepcao" ? "recepcao" : c === "educador" ? "educador" : "saude")));
  return { preset: "completa", destinos: [...new Set([...menus].flatMap((m) => MENUS[m]))] };
}

const PACIENTES = [
  { nome: "Ana Beatriz Ferreira (demo)", tel: "+5511900000101", origem: "Instagram", detalhe: "Anúncio pago" },
  { nome: "Bruno Henrique Dias (demo)", tel: "+5511900000102", origem: "Indicação", detalhe: "Indicado por Ana Beatriz" },
  { nome: "Cecília Moura (demo)", tel: "+5511900000103", origem: "Encaminhamento médico", detalhe: "Dr. Fictício" },
  { nome: "Daniel Okada (demo)", tel: "+5511900000104", origem: "WhatsApp" },
  { nome: "Eduarda Nunes (demo)", tel: "+5511900000105", origem: "Instagram", detalhe: "Influenciadora fictícia" },
  { nome: "Fernando Ribeiro (demo)", tel: "+5511900000106", origem: "Indicação", detalhe: "Amigo da recepção" },
];
const ORIGENS = [
  { nome: "WhatsApp", tipo: "whatsapp" },
  { nome: "Instagram", tipo: "instagram" },
  { nome: "Indicação", tipo: "indicacao" },
  { nome: "Encaminhamento médico", tipo: "encaminhamento" },
];
const TIPOS = [
  { slug: "avaliacao-fisio", name: "Avaliação de fisioterapia", category: "consulta", dur: 60, price: 25000, mod: "fisioterapia" },
  { slug: "sessao-fisio", name: "Sessão de fisioterapia", category: "procedimento", dur: 50, price: 18000, mod: "fisioterapia" },
  { slug: "aula-pilates", name: "Aula de pilates", category: "procedimento", dur: 55, price: 9000, mod: "pilates" },
  { slug: "consulta-medica", name: "Consulta médica", category: "consulta", dur: 30, price: 35000, mod: "medicina" },
  { slug: "enfermagem", name: "Atendimento de enfermagem", category: "procedimento", dur: 30, price: 12000, mod: "enfermagem" },
];

// ── HTTP ────────────────────────────────────────────────────────────────────
const H = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" };
async function http(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo, headers: { ...H, ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho.split("?")[0]} → ${r.status} ${texto.slice(0, 400)}`);
  return texto ? JSON.parse(texto) : null;
}
const sel = (tabela, q) => http("GET", `/rest/v1/${tabela}?${q}`);
const ins = (tabela, linhas, q = "") =>
  http("POST", `/rest/v1/${tabela}${q ? `?${q}` : ""}`, linhas, { Prefer: "return=representation" });
const upd = (tabela, q, val) => http("PATCH", `/rest/v1/${tabela}?${q}`, val, { Prefer: "return=minimal" });
async function contar(tabela, q) {
  const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?${q}&select=*`, {
    method: "HEAD", headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok && r.status !== 206) throw new Error(`HEAD ${tabela} → ${r.status}`);
  return Number((r.headers.get("content-range") ?? "*/0").split("/")[1]);
}
const del = (tabela, q) => http("DELETE", `/rest/v1/${tabela}?${q}`, undefined, { Prefer: "return=minimal" });

async function usuariosExistentes() {
  const achados = new Map();
  for (let pagina = 1; pagina < 50; pagina++) {
    const r = await http("GET", `/auth/v1/admin/users?page=${pagina}&per_page=200`);
    const lista = r.users ?? [];
    for (const u of lista) if (u.email) achados.set(u.email.toLowerCase(), u.id);
    if (lista.length < 200) break;
  }
  return achados;
}

// Brasília sem horário de verão: UTC-3.
function emBrasilia(dias, hora, min = 0) {
  const agora = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + dias, hora + 3, min));
}

// ── conferir ────────────────────────────────────────────────────────────────
async function estado() {
  const [org] = await sel("organizations", `slug=eq.${SLUG}&select=id,display_name`);
  const usuarios = await usuariosExistentes();
  const conflitos = [];
  for (const u of EQUIPE) {
    const id = usuarios.get(u.email);
    if (!id) continue;
    const vinculos = await sel("user_organizations", `user_id=eq.${id}&select=organization_id`);
    if (vinculos.some((v) => v.organization_id !== org?.id)) conflitos.push(u.email);
  }
  return { org, usuarios, conflitos };
}

async function conferir() {
  const { org, usuarios, conflitos } = await estado();
  console.log(`organizações na instalação: ${await contar("organizations", "id=not.is.null")}`);
  console.log(org ? `demonstração já existe: ${org.display_name} (${org.id})` : "demonstração ainda não existe");
  for (const u of EQUIPE) console.log(`  ${usuarios.has(u.email) ? "existe " : "criar  "} ${u.email}`);
  await sel("clinica_cargos_membro", "select=cargo&limit=1"); // falha se o módulo clínica não estiver instalado
  await sel("clinica_politicas", "select=interface_nova_principal&limit=1");
  console.log("módulo clínica: instalado");
  if (conflitos.length) throw new Error(`recusado: já são membros de outra organização: ${conflitos.join(", ")}`);
  console.log("ok para criar");
}

// ── criar ───────────────────────────────────────────────────────────────────
async function criar() {
  let { org, usuarios, conflitos } = await estado();
  if (conflitos.length) throw new Error(`recusado: já são membros de outra organização: ${conflitos.join(", ")}`);
  if (!org) {
    [org] = await ins("organizations", {
      slug: SLUG, display_name: NOME_ORG, legal_name: NOME_ORG, status: "active",
      timezone: "America/Sao_Paulo", locale: "pt-BR", onboarded_at: new Date().toISOString(),
      settings: { plan: "standard", demonstracao: true },
    });
    console.log(`✓ organização criada (${org.id})`);
  }
  const O = org.id;
  const naOrg = `organization_id=eq.${O}`;

  const ids = {};
  for (const u of EQUIPE) {
    let id = usuarios.get(u.email);
    if (!id) {
      const c = await http("POST", "/auth/v1/admin/users", {
        email: u.email, password: SENHA, email_confirm: true, user_metadata: { full_name: u.nome, demonstracao: true },
      });
      id = c.id ?? c.user?.id;
      console.log(`✓ login ${u.email}`);
    }
    ids[u.chave] = id;
    await upd("profiles", `id=eq.${id}`, { full_name: u.nome }).catch(() => {});
    const [vinculo] = await sel("user_organizations", `${naOrg}&user_id=eq.${id}&select=id`);
    const linha = { role: papelDos(u.cargos), interface_settings: interfaceDos(u.cargos) };
    if (vinculo) await upd("user_organizations", `id=eq.${vinculo.id}`, linha);
    else await ins("user_organizations", { organization_id: O, user_id: id, accepted_at: new Date().toISOString(), ...linha });
    await ins("clinica_cargos_membro",
      u.cargos.map((cargo) => ({ organization_id: O, user_id: id, cargo, definido_por: null })),
      "on_conflict=organization_id,user_id,cargo").catch((e) => { if (!/23505|duplicate/.test(e.message)) throw e; });
    const saude = u.cargos.find((c) => SAUDE[c]);
    if (saude) {
      const [prof] = await sel("clinica_profissionais", `${naOrg}&user_id=eq.${id}&select=id`);
      const p = { nome_profissional: u.nome.replace(/ \(demo\)$/, ""), registro_numero: u.registro, registro_uf: "SP", ...SAUDE[saude], ativo: true };
      if (prof) await upd("clinica_profissionais", `id=eq.${prof.id}`, p);
      else await ins("clinica_profissionais", { organization_id: O, user_id: id, ...p });
    }
  }
  console.log("✓ perfis gravados");

  // A organização usa a interface nova como principal, como a TOQ decidiu.
  const [pol] = await sel("clinica_politicas", `${naOrg}&select=organization_id`);
  if (pol) await upd("clinica_politicas", naOrg, { interface_nova_principal: true });
  else await ins("clinica_politicas", { organization_id: O, interface_nova_principal: true });

  if (await contar("contacts", naOrg)) return console.log("dados fictícios já semeados; nada mais a fazer");

  const tipo = {};
  for (const [i, t] of TIPOS.entries()) {
    const [r] = await ins("calendar_event_types", {
      organization_id: O, slug: t.slug, name: t.name, category: t.category, duration_minutes: t.dur,
      default_price_cents: t.price, position: i + 1, minimum_notice_minutes: 60, reminder_enabled: false,
    }, "on_conflict=organization_id,slug");
    tipo[t.slug] = r.id;
    await ins("clinica_tipos_atendimento", { organization_id: O, event_type_id: r.id, modalidade: t.mod });
  }
  const origem = {};
  for (const [i, o] of ORIGENS.entries()) {
    const [r] = await ins("clinica_origens", { organization_id: O, nome: o.nome, tipo: o.tipo, ordem: (i + 1) * 10 });
    origem[o.nome] = r.id;
  }
  const pac = [];
  for (const p of PACIENTES) {
    const primeiro = p.nome.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const [r] = await ins("contacts", {
      organization_id: O, name: p.nome, phone_number: p.tel, source: "manual",
      email: `${primeiro}@${DOMINIO}`, tags: ["paciente"], custom_fields: { demonstracao: true },
    });
    pac.push(r.id);
    await ins("clinica_pacientes_origem", {
      organization_id: O, contact_id: r.id, origem_id: origem[p.origem], detalhe: p.detalhe ?? null,
      registrado_por_user_id: ids.recepcao,
    });
  }
  console.log(`✓ ${pac.length} pacientes fictícios`);

  const agenda = [
    { p: 0, t: "avaliacao-fisio", u: "fisio", d: -2, h: 9, st: "completed" },
    { p: 2, t: "consulta-medica", u: "medico", d: -1, h: 14, st: "completed" },
    { p: 3, t: "aula-pilates", u: "educador", d: -1, h: 18, st: "no_show" },
    { p: 5, t: "enfermagem", u: "enfermeiro", d: -1, h: 11, st: "completed" },
    { p: 0, t: "sessao-fisio", u: "fisio", d: 0, h: 9, st: "confirmed" },
    { p: 4, t: "avaliacao-fisio", u: "gerfisio", d: 0, h: 11, st: "pending" },
    { p: 1, t: "consulta-medica", u: "medico", d: 0, h: 15, st: "confirmed" },
    { p: 3, t: "aula-pilates", u: "educador", d: 0, h: 18, st: "confirmed" },
    { p: 0, t: "sessao-fisio", u: "fisio", d: 2, h: 9, st: "confirmed" },
    { p: 5, t: "aula-pilates", u: "gerfisio", d: 1, h: 17, st: "pending" },
    { p: 2, t: "enfermagem", u: "enfermeiro", d: 3, h: 10, st: "confirmed" },
  ];
  for (const a of agenda) {
    const t = TIPOS.find((x) => x.slug === a.t);
    const ini = emBrasilia(a.d, a.h);
    await ins("calendar_appointments", {
      organization_id: O, event_type_id: tipo[a.t], title: t.name, starts_at: ini.toISOString(),
      ends_at: new Date(ini.getTime() + t.dur * 60000).toISOString(), status: a.st, owner_user_id: ids[a.u],
      contact_id: pac[a.p], created_by_kind: "system", source: "ui", location_kind: "in_person",
    });
  }
  console.log(`✓ ${agenda.length} agendamentos (passados, hoje e próximos dias)`);

  const [produto] = await ins("clinica_produtos", {
    organization_id: O, nome: "Pacote 10 sessões de fisioterapia", modalidade: "fisioterapia",
    sessoes: 10, validade_dias: 60, valor_cents: 160000,
  });
  await ins("clinica_produtos", {
    organization_id: O, nome: "Pacote 8 aulas de pilates", modalidade: "pilates", sessoes: 8, validade_dias: 60, valor_cents: 64000,
  });
  const compra = emBrasilia(-2, 10);
  await ins("clinica_pacotes", {
    organization_id: O, contact_id: pac[0], produto_id: produto.id, nome: produto.nome, modalidade: "fisioterapia",
    sessoes_total: 10, valor_cents: 160000, comprado_em: compra.toISOString(),
    valido_ate: new Date(compra.getTime() + 60 * 86400e3).toISOString(),
    aceite_politica_em: compra.toISOString(), aceite_multa_pct: 30, aceite_antecedencia_horas: 24,
    vendido_por_user_id: ids.recepcao,
  });
  console.log("✓ pacotes à venda e um pacote vendido");

  const tarefas = [
    { title: "Ligar para Daniel Okada sobre a falta no pilates", p: 3, u: "recepcao", d: 0, pr: "high" },
    { title: "Oferecer renovação do pacote para Ana Beatriz", p: 0, u: "recepcao", d: 2, pr: "medium" },
    { title: "Conferir fechamento do mês para a contabilidade", p: null, u: "financeiro", d: 3, pr: "medium" },
  ];
  for (const t of tarefas) {
    await ins("crm_tasks", {
      organization_id: O, title: t.title, contact_id: t.p === null ? null : pac[t.p], assigned_to: ids[t.u],
      created_by: ids.admin, due_date: emBrasilia(t.d, 17).toISOString(), priority: t.pr,
    });
  }
  console.log("✓ tarefas");
  console.log(`pronto: ${EQUIPE.length} logins, senha ${SENHA}`);
}

// ── apagar ──────────────────────────────────────────────────────────────────
async function apagar() {
  const { org, usuarios, conflitos } = await estado();
  if (conflitos.length) throw new Error(`recusado: membros de outra organização: ${conflitos.join(", ")}`);
  if (org) {
    const naOrg = `organization_id=eq.${org.id}`;
    // Chaves `restrict` primeiro, depois a organização leva o resto em cascata.
    for (const t of ["clinica_pacote_consumos", "clinica_pacote_eventos", "clinica_pacotes", "calendar_appointments", "crm_tasks"]) {
      await del(t, naOrg).catch((e) => console.log(`  ${t}: ${e.message}`));
    }
    await del("organizations", `id=eq.${org.id}&slug=eq.${SLUG}`);
    console.log("✓ organização de demonstração apagada");
  }
  for (const u of EQUIPE) {
    const id = usuarios.get(u.email);
    if (id) { await http("DELETE", `/auth/v1/admin/users/${id}`); console.log(`✓ login apagado ${u.email}`); }
  }
}

({ conferir, criar, apagar })[ACAO]().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
