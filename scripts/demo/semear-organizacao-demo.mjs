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
  http("POST", `/rest/v1/${tabela}${q ? `?${q}` : ""}`, linhas, { Prefer: "return=representation,missing=default" });
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

  if (await contar("contacts", naOrg)) console.log("primeiro lote já semeado");
  else {

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
  }
  await ampliar(O, ids);
  console.log(`pronto: ${EQUIPE.length} logins, senha ${SENHA}`);
}

// ── segundo lote: volume para a agenda, o prontuário e os relatórios ─────────
// Gerado por sorteio com semente fixa: rodar de novo dá os mesmos nomes. A marca do lote é a
// etiqueta `demo-lote-2` nos pacientes; com ela presente, nada se repete.
function sorteio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PRIMEIROS = ["Lucas", "Mariana", "Pedro", "Juliana", "Rafael", "Beatriz", "Thiago", "Larissa", "Gustavo", "Camila",
  "Felipe", "Patrícia", "Rodrigo", "Aline", "Marcelo", "Vanessa", "André", "Renata", "Diego", "Fernanda",
  "Leonardo", "Tatiane", "Vinícius", "Priscila", "Eduardo", "Carolina", "Fábio", "Simone", "Ricardo", "Luana",
  "Mateus", "Isabela", "Caio", "Bruna", "Henrique", "Natália", "Otávio", "Sabrina", "Igor", "Débora"];
const SOBRENOMES = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Farias", "Gomes", "Henriques", "Lima", "Machado",
  "Nogueira", "Oliveira", "Pereira", "Queiroz", "Rezende", "Santos", "Teixeira", "Vasconcelos", "Xavier", "Zanetti"];
const DETALHE = { Instagram: ["Anúncio pago", "Influenciadora fictícia", "Post orgânico"], "Indicação": ["Indicado por paciente", "Amigo da equipe"],
  "Encaminhamento médico": ["Ortopedista fictício", "Clínico geral fictício"], WhatsApp: [null] };
const QUEIXAS = ["Dor lombar ao ficar sentado", "Dor no joelho ao subir escadas", "Rigidez no ombro direito", "Dor cervical no fim do dia",
  "Recuperação pós-cirurgia de LCA", "Tendinite no punho", "Entorse de tornozelo", "Dor no quadril ao caminhar", "Postura e fortalecimento"];
const CONDUTAS = ["Mobilidade e alongamento", "Fortalecimento de core", "Liberação miofascial e exercícios", "Treino de equilíbrio",
  "Exercícios resistidos progressivos", "Terapia manual e orientação postural"];

async function emLotes(tabela, linhas, q = "") {
  const saida = [];
  for (let i = 0; i < linhas.length; i += 250) saida.push(...(await ins(tabela, linhas.slice(i, i + 250), q)));
  return saida;
}

async function ampliar(O, ids) {
  const naOrg = `organization_id=eq.${O}`;
  if (await contar("contacts", `${naOrg}&tags=cs.%7Bdemo-lote-2%7D`)) return console.log("segundo lote já semeado");
  const r = sorteio(20261009);
  const um = (lista) => lista[Math.floor(r() * lista.length)];
  const DIA = 86400e3;

  // A jornada de quem atende e da recepção: a Agenda só oferece horário depois dela.
  const semana = (ini, fim, sabado) => [1, 2, 3, 4, 5].map((dow) => ({ dow, start: ini, end: fim }))
    .concat(sabado ? [{ dow: 6, start: "08:00", end: "12:00" }] : []);
  for (const chave of ["recepcao", "medico", "fisio", "gerfisio", "enfermeiro", "educador"]) {
    const linha = { organization_id: O, user_id: ids[chave], is_available: true, capacity: 5,
      schedule: { timezone: "America/Sao_Paulo", windows: semana("08:00", "18:00", chave !== "recepcao" && chave !== "medico") } };
    const [ex] = await sel("attendant_availability", `${naOrg}&user_id=eq.${ids[chave]}&select=id`);
    if (ex) await upd("attendant_availability", `id=eq.${ex.id}`, { schedule: linha.schedule, is_available: true });
    else await ins("attendant_availability", linha);
  }
  console.log("✓ jornada publicada para quem atende");

  // Pacientes novos, chegando ao longo dos últimos 90 dias.
  const tipos = Object.fromEntries((await sel("calendar_event_types", `${naOrg}&select=id,slug,name,duration_minutes,default_price_cents`)).map((t) => [t.slug, t]));
  const origens = Object.fromEntries((await sel("clinica_origens", `${naOrg}&select=id,nome`)).map((o) => [o.nome, o.id]));
  const novos = [];
  const usados = new Set();
  while (novos.length < 40) {
    const nome = `${um(PRIMEIROS)} ${um(SOBRENOMES)}`;
    if (usados.has(nome)) continue;
    usados.add(nome);
    const n = novos.length + 1;
    novos.push({ nome: `${nome} (demo)`, tel: `+55119000002${String(n).padStart(2, "0")}`, origem: um(Object.keys(DETALHE)),
      criado: new Date(Date.now() - Math.floor(r() * 90) * DIA).toISOString() });
  }
  const contatos = await emLotes("contacts", novos.map((p, i) => ({
    organization_id: O, name: p.nome, phone_number: p.tel, source: "manual", created_at: p.criado,
    email: `paciente${i + 7}@${DOMINIO}`, tags: ["paciente", "demo-lote-2"], custom_fields: { demonstracao: true },
  })));
  await emLotes("clinica_pacientes_origem", contatos.map((c, i) => ({
    organization_id: O, contact_id: c.id, origem_id: origens[novos[i].origem], detalhe: um(DETALHE[novos[i].origem]),
    registrado_por_user_id: ids.recepcao, created_at: novos[i].criado,
  })));
  const todos = (await sel("contacts", `${naOrg}&select=id,name&order=created_at`)).map((c) => c.id);
  console.log(`✓ ${contatos.length} pacientes a mais (${todos.length} no total)`);

  // Agenda: seis semanas para trás e três para frente, dias úteis, um horário cheio por vez.
  // Ninguém fica em dois lugares na mesma hora: nem o profissional, nem o paciente.
  const existentes = await sel("calendar_appointments", `${naOrg}&select=owner_user_id,contact_id,starts_at`);
  const ocupado = new Set(existentes.flatMap((a) => [`${a.owner_user_id}|${a.starts_at.slice(0, 13)}`, `${a.contact_id}|${a.starts_at.slice(0, 13)}`]));
  const QUEM = [
    { chave: "medico", tipos: ["consulta-medica", "consulta-medica", "consulta-medica"], mod: "medicina", porDia: [3, 5] },
    { chave: "fisio", tipos: ["sessao-fisio", "sessao-fisio", "sessao-fisio", "avaliacao-fisio", "aula-pilates"], mod: null, porDia: [5, 7] },
    { chave: "gerfisio", tipos: ["sessao-fisio", "sessao-fisio", "aula-pilates", "avaliacao-fisio"], mod: null, porDia: [2, 4] },
    { chave: "enfermeiro", tipos: ["enfermagem"], mod: "enfermagem", porDia: [2, 4] },
    { chave: "educador", tipos: ["aula-pilates"], mod: "pilates", porDia: [4, 6] },
  ];
  // Cada profissional tem a sua carteira de pacientes, para o histórico fazer sentido.
  const carteira = Object.fromEntries(QUEM.map((q) => [q.chave, Array.from({ length: 14 }, () => um(todos))]));
  const agora = Date.now();
  const novas = [];
  for (let d = -42; d <= 21; d++) {
    const dia = emBrasilia(d, 0);
    const dow = new Date(dia.getTime() - 3 * 3600e3).getUTCDay();
    if (dow === 0 || dow === 6 || d === 0) continue; // hoje já tem a agenda do primeiro lote
    for (const q of QUEM) {
      const quantos = q.porDia[0] + Math.floor(r() * (q.porDia[1] - q.porDia[0] + 1));
      const horas = [8, 9, 10, 11, 13, 14, 15, 16, 17].sort(() => r() - 0.5).slice(0, quantos);
      for (const h of horas) {
        const ini = emBrasilia(d, h);
        const chaveHora = ini.toISOString().slice(0, 13);
        const pac = um(carteira[q.chave]);
        if (ocupado.has(`${ids[q.chave]}|${chaveHora}`) || ocupado.has(`${pac}|${chaveHora}`)) continue;
        ocupado.add(`${ids[q.chave]}|${chaveHora}`);
        ocupado.add(`${pac}|${chaveHora}`);
        const t = tipos[um(q.tipos)];
        const passado = ini.getTime() < agora;
        const x = r();
        const status = passado
          ? x < 0.78 ? "completed" : x < 0.87 ? "no_show" : x < 0.97 ? "cancelled" : "confirmed"
          : x < 0.68 ? "confirmed" : x < 0.95 ? "pending" : "cancelled";
        const cancelado = status === "cancelled" ? new Date(ini.getTime() - (2 + Math.floor(r() * 46)) * 3600e3) : null;
        novas.push({
          organization_id: O, event_type_id: t.id, title: t.name, starts_at: ini.toISOString(),
          ends_at: new Date(ini.getTime() + t.duration_minutes * 60000).toISOString(), status,
          owner_user_id: ids[q.chave], contact_id: pac, created_by_kind: "system", source: "ui", location_kind: "in_person",
          cancelled_at: cancelado?.toISOString() ?? null,
          cancellation_reason: cancelado ? um(["Paciente avisou que não poderia vir", "Imprevisto no trabalho", "Paciente doente"]) : null,
          created_at: new Date(Math.min(ini.getTime() - 3 * DIA, agora)).toISOString(),
        });
      }
    }
  }
  const agenda = await emLotes("calendar_appointments", novas);
  console.log(`✓ ${agenda.length} agendamentos de ${QUEM.length} profissionais (6 semanas atrás, 3 à frente)`);

  // Multa: cancelamento com menos de 24h de antecedência (30%), em situações variadas.
  const multas = [];
  for (const a of agenda) {
    if (a.status !== "cancelled") continue;
    const horas = (new Date(a.starts_at) - new Date(a.cancelled_at)) / 3600e3;
    if (horas >= 24) continue;
    const t = Object.values(tipos).find((x) => x.id === a.event_type_id);
    const sit = r();
    multas.push({
      organization_id: O, appointment_id: a.id, contact_id: a.contact_id, percentual: 30,
      antecedencia_horas: Number(horas.toFixed(2)), valor_cents: Math.round((t.default_price_cents ?? 0) * 0.3), created_at: a.cancelled_at,
      status: sit < 0.5 ? "pendente" : sit < 0.8 ? "paga" : "isenta",
      isencao_motivo: sit >= 0.8 ? "Atestado médico apresentado" : null,
      isenta_em: sit >= 0.8 ? a.cancelled_at : null,
      isenta_por_user_id: sit >= 0.8 ? ids.gerente : null,
    });
  }
  if (multas.length) await emLotes("clinica_multas", multas);
  console.log(`✓ ${multas.length} multas por cancelamento em cima da hora`);

  // Pacotes: quem faz fisioterapia ou pilates com frequência comprou um, e as sessões gastaram.
  const [produtoFisio] = await sel("clinica_produtos", `${naOrg}&modalidade=eq.fisioterapia&select=id,nome,sessoes,valor_cents`);
  const [produtoPilates] = await sel("clinica_produtos", `${naOrg}&modalidade=eq.pilates&select=id,nome,sessoes,valor_cents`);
  const jaTemPacote = new Set((await sel("clinica_pacotes", `${naOrg}&select=contact_id`)).map((p) => p.contact_id));
  const modDoTipo = { "sessao-fisio": "fisioterapia", "avaliacao-fisio": "fisioterapia", "aula-pilates": "pilates" };
  const porPaciente = new Map();
  for (const a of agenda) {
    const slug = Object.values(tipos).find((x) => x.id === a.event_type_id)?.slug;
    const mod = modDoTipo[slug];
    if (!mod || slug === "avaliacao-fisio") continue;
    const k = `${a.contact_id}|${mod}`;
    if (!porPaciente.has(k)) porPaciente.set(k, []);
    porPaciente.get(k).push(a);
  }
  let vendidos = 0, consumos = 0;
  for (const [k, sessoes] of porPaciente) {
    const [contato, mod] = k.split("|");
    if (sessoes.length < 4 || jaTemPacote.has(contato) || r() < 0.25) continue;
    const prod = mod === "fisioterapia" ? produtoFisio : produtoPilates;
    sessoes.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const compra = new Date(new Date(sessoes[0].starts_at).getTime() - DIA);
    const cancelar = vendidos === 3;
    const [pac] = await ins("clinica_pacotes", {
      organization_id: O, contact_id: contato, produto_id: prod.id, nome: prod.nome, modalidade: mod, sessoes_total: prod.sessoes,
      valor_cents: prod.valor_cents, comprado_em: compra.toISOString(), valido_ate: new Date(compra.getTime() + 60 * DIA).toISOString(),
      aceite_politica_em: compra.toISOString(), aceite_multa_pct: 30, aceite_antecedencia_horas: 24, vendido_por_user_id: ids.recepcao,
      created_at: compra.toISOString(),
      ...(cancelar ? { status: "cancelado", cancelado_em: new Date(compra.getTime() + 20 * DIA).toISOString(), cancelamento_motivo: "Paciente mudou de cidade" } : {}),
    });
    vendidos++;
    jaTemPacote.add(contato);
    const gastas = sessoes.filter((s) => (s.status === "completed" || s.status === "no_show")
      && (!cancelar || new Date(s.starts_at) < new Date(compra.getTime() + 20 * DIA))).slice(0, prod.sessoes);
    if (gastas.length) {
      await ins("clinica_pacote_consumos", gastas.map((s) => ({
        organization_id: O, pacote_id: pac.id, appointment_id: s.id, motivo: s.status === "completed" ? "realizada" : "falta",
        sessao_em: s.starts_at, consumido_em: s.ends_at,
      })));
      consumos += gastas.length;
    }
    if (cancelar) {
      const restantes = prod.sessoes - gastas.length;
      await ins("clinica_pacote_eventos", { organization_id: O, pacote_id: pac.id, tipo: "cancelamento", motivo: "Paciente mudou de cidade",
        valor_cents: Math.round((prod.valor_cents / prod.sessoes) * restantes), por_user_id: ids.gerente, registrado_em: pac.cancelado_em });
    }
  }
  console.log(`✓ ${vendidos} pacotes vendidos, ${consumos} sessões gastas`);

  // Prontuário: avaliação no primeiro atendimento, evolução nos seguintes. Uns 15% ficam sem
  // evolução de propósito, para a lista de evoluções pendentes ter o que mostrar.
  const profs = Object.fromEntries((await sel("clinica_profissionais", `${naOrg}&select=user_id,nome_profissional,conselho,registro_numero,registro_uf`))
    .map((p) => [p.user_id, p]));
  const modDoAtendimento = { "consulta-medica": "medicina", enfermagem: "enfermagem", "aula-pilates": "pilates", "sessao-fisio": "fisioterapia", "avaliacao-fisio": "fisioterapia", reavaliacao: "fisioterapia" };
  const vistos = new Set();
  const registros = [];
  for (const a of [...agenda].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    if (a.status !== "completed") continue;
    const slug = Object.values(tipos).find((x) => x.id === a.event_type_id)?.slug;
    const mod = modDoAtendimento[slug];
    const p = profs[a.owner_user_id];
    if (!mod || !p) continue;
    const primeira = !vistos.has(`${a.contact_id}|${mod}`);
    vistos.add(`${a.contact_id}|${mod}`);
    if (!primeira && r() < 0.15) continue;
    const dor = 2 + Math.floor(r() * 7);
    const conteudo = mod === "medicina"
      ? { queixa: um(QUEIXAS), exame_fisico: "Sem alterações agudas", hipotese: "Quadro musculoesquelético", conduta: "Encaminhar para fisioterapia" }
      : mod === "enfermagem"
        ? { pressao: um(["12x8", "11x7", "13x8"]), frequencia_cardiaca: 60 + Math.floor(r() * 30), saturacao: 96 + Math.floor(r() * 4), procedimento: "Aferição de sinais vitais" }
        : { queixa: um(QUEIXAS), dor, conduta: um(CONDUTAS) };
    registros.push({
      organization_id: O, contact_id: a.contact_id, appointment_id: a.id, modalidade: mod,
      tipo: primeira && mod !== "enfermagem" ? "avaliacao" : "evolucao", conteudo,
      texto: primeira ? null : `Paciente relata dor ${dor}/10. Evolução dentro do esperado.`,
      autor_user_id: a.owner_user_id, autor_nome: p.nome_profissional,
      autor_registro: `${p.conselho}-${p.registro_uf} ${p.registro_numero}`, assinado_em: a.ends_at, created_at: a.ends_at,
    });
  }
  await emLotes("prontuario_registros", registros);
  console.log(`✓ ${registros.length} registros de prontuário assinados`);

  // Tarefas para a equipe toda, abertas, em andamento e concluídas.
  const TAREFAS = ["Confirmar presença de amanhã", "Ligar sobre a falta", "Oferecer renovação do pacote", "Enviar recibo para reembolso",
    "Cobrar multa pendente", "Agendar reavaliação", "Atualizar cadastro do paciente", "Retornar mensagem do WhatsApp"];
  const DONOS = ["recepcao", "recepcao", "recepcao", "fisio", "medico", "financeiro", "gerente", "enfermeiro", "educador"];
  await emLotes("crm_tasks", Array.from({ length: 24 }, (_, i) => {
    const d = -10 + Math.floor(r() * 20);
    return {
      organization_id: O, title: um(TAREFAS), contact_id: um(todos), assigned_to: ids[um(DONOS)], created_by: ids.admin,
      due_date: emBrasilia(d, 17).toISOString(), priority: um(["low", "medium", "medium", "high"]),
      status: d < 0 ? um(["done", "done", "pending"]) : um(["pending", "pending", "in_progress"]),
    };
  }));
  console.log("✓ 24 tarefas a mais");
}

// ── apagar ──────────────────────────────────────────────────────────────────
async function apagar() {
  const { org, usuarios, conflitos } = await estado();
  if (conflitos.length) throw new Error(`recusado: membros de outra organização: ${conflitos.join(", ")}`);
  if (org) {
    const naOrg = `organization_id=eq.${org.id}`;
    // Chaves `restrict` primeiro, depois a organização leva o resto em cascata.
    // O prontuário é imutável e prende os compromissos e os pacientes: só a cascata da própria
    // organização o leva. Por isso os compromissos não são apagados antes, e sim junto.
    for (const t of ["clinica_pacote_consumos", "clinica_pacote_eventos", "clinica_pacotes", "clinica_multas", "crm_tasks"]) {
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
