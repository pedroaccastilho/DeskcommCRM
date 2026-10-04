#!/usr/bin/env bash
# Comando FORÇADO da chave de deploy do GitHub Actions na VPS da TOQ.
#
# Mora fora do repositório na VPS (~/.local/bin/toq-deploy-por-ssh), instalado
# por infra/toq-vps/configurar-deploy-automatico.sh, e é amarrado à chave no
# authorized_keys:
#
#   command="~/.local/bin/toq-deploy-por-ssh /caminho/deskcommcrm",restrict ssh-ed25519 AAAA… deploy-github-actions
#
# Quem tem a chave privada (o workflow deploy-vps.yml) não ganha shell: o sshd
# roda SEMPRE este arquivo, e o que o cliente pediu chega só como texto em
# SSH_ORIGINAL_COMMAND. Aceita exatamente uma coisa — "deploy vX.Y.Z" — e
# responde rodando o update.sh do kit com `--to` nessa versão.
#
# O update leva uns 13 minutos. Ele roda DESACOPLADO da conexão (setsid +
# nohup): se o SSH cair no meio, a atualização termina sozinha em vez de morrer
# com o CRM em manutenção. A saída completa fica em .deploy-actions.log, na
# pasta do projeto; para o GitHub só vão as linhas de etapa ("▶ …", "✓ …",
# "✖ …"), porque o log do Actions de um repositório público é público.
#
# Uma atualização por vez: usa o MESMO lock do botão "Atualizar agora" da tela
# (agent.sh, `.update.lock`). Lock ocupado sai com 75 sem tocar em nada.
set -uo pipefail

PROJETO="${1:-$HOME/deskcommcrm}"
LOCK="${PROJETO}/.update.lock"
LOG="${PROJETO}/.deploy-actions.log"
STATUS="${PROJETO}/.deploy-actions.status"

pedido="${SSH_ORIGINAL_COMMAND:-}"
if ! [[ "$pedido" =~ ^deploy\ (v[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "✖ pedido recusado. Esta chave só aceita: deploy vX.Y.Z" >&2
  exit 64
fi
versao="${BASH_REMATCH[1]}"

[ -f "${PROJETO}/hostgator-setup-kit/update.sh" ] || {
  echo "✖ não achei ${PROJETO}/hostgator-setup-kit/update.sh" >&2
  exit 66
}
command -v flock >/dev/null 2>&1 || { echo "✖ falta o comando flock na VPS" >&2; exit 69; }

rm -f "$STATUS"
: >"$LOG"
echo "▶ deploy ${versao} pedido pelo GitHub Actions em $(date -u +%FT%TZ)"

# shellcheck disable=SC2016 # as variáveis expandem dentro do bash -c
setsid nohup bash -c '
  cd "$1" || { echo 66 >"$4"; exit; }
  flock -n -E 75 "$2" bash hostgator-setup-kit/update.sh --to "$3"
  echo $? >"$4"
' _ "$PROJETO" "$LOCK" "$versao" "$STATUS" >>"$LOG" 2>&1 </dev/null &
filho=$!

# Acompanha o log até o status aparecer, repassando só as linhas de etapa.
# Laço de leitura, e não `tail -f`: um tail órfão segura o canal do SSH aberto
# depois que este script sai, e o job do Actions ficaria pendurado até o teto.
lidas=0
repassar() {
  local total
  total="$(wc -l <"$LOG")"
  if [ "$total" -gt "$lidas" ]; then
    sed -n "$((lidas + 1)),${total}p" "$LOG" \
      | sed 's/\x1b\[[0-9;]*m//g' \
      | grep -E '^[[:space:]]*(▶|✓|✔|✖|⚠)' || true
    lidas="$total"
  fi
}
while [ ! -s "$STATUS" ]; do
  repassar
  if ! kill -0 "$filho" 2>/dev/null; then
    sleep 2
    [ -s "$STATUS" ] && break
    repassar
    echo "✖ a atualização parou sem dizer como terminou. Log completo na VPS: ${LOG}"
    exit 70
  fi
  sleep 5
done
repassar

codigo="$(cat "$STATUS")"
case "$codigo" in
  0) echo "✓ update.sh terminou bem (${versao})" ;;
  75) echo "✖ já tem uma atualização rodando na VPS (lock ocupado); nada foi feito" ;;
  *) echo "✖ update.sh saiu com ${codigo}. Log completo na VPS: ${LOG}" ;;
esac
exit "$codigo"
