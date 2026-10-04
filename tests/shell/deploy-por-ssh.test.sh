#!/usr/bin/env bash
# Prova do comando forçado da chave de deploy da VPS da TOQ
# (infra/toq-vps/deploy-por-ssh.sh), que o workflow deploy-vps.yml chama por SSH.
#
#   bash tests/shell/deploy-por-ssh.test.sh
#
# O que precisa ficar de pé:
#   - só "deploy vX.Y.Z" passa; qualquer outra coisa (shell, `;`, versão torta)
#     é recusada sem rodar nada;
#   - o update.sh roda com `--to` na versão pedida e o código de saída dele volta;
#   - com o lock do botão "Atualizar agora" ocupado, nada roda (saída 75);
#   - para o GitHub só vão as linhas de etapa, nunca o resto do log.
#
# O update.sh aqui é um dublê numa pasta temporária; nada toca a máquina.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infra/toq-vps" && pwd)/deploy-por-ssh.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/hostgator-setup-kit"
cat >"$WORK/hostgator-setup-kit/update.sh" <<'DUBLE'
echo "args: $*" >"$PWD/.args"
printf '\n\033[1m▶ Procurando atualizações\033[0m\n'
echo "SEGREDO=nao-pode-sair"
echo "✓ pronto"
exit "${SAIDA_DUBLE:-0}"
DUBLE

FAILS=0
check() {  # check <descrição> <condição...>
  local d="$1"; shift
  if "$@"; then echo "  ✓ $d"; else echo "  ✗ $d"; FAILS=$((FAILS + 1)); fi
}
rodar() {  # rodar <pedido> → saída em $WORK/out, código em $WORK/rc
  rm -f "$WORK/.args"
  SSH_ORIGINAL_COMMAND="$1" bash "$SCRIPT" "$WORK" >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
rc() { cat "$WORK/rc"; }

echo "pedidos recusados"
for pedido in "" "whoami" "deploy" "deploy v1.2" "deploy 1.2.3" "deploy v1.2.3; id" "deploy v1.2.3 --force" "bash -i"; do
  rodar "$pedido"
  check "recusa '${pedido}'" test "$(rc)" = 64
  check "'${pedido}' não roda o update" test ! -e "$WORK/.args"
done

echo "deploy normal"
rodar "deploy v1.74.0"
check "sai 0" test "$(rc)" = 0
check "chama update.sh --to v1.74.0" grep -qx "args: --to v1.74.0" "$WORK/.args"
check "repassa a linha de etapa" grep -q "▶ Procurando atualizações" "$WORK/out"
check "não repassa o resto do log" bash -c "! grep -q SEGREDO '$WORK/out'"
check "o log completo fica na VPS" grep -q SEGREDO "$WORK/.deploy-actions.log"

echo "update.sh falhando"
SAIDA_DUBLE=3 rodar "deploy v1.74.0"
check "devolve o código do update.sh" test "$(rc)" = 3

echo "lock ocupado"
( flock 9; sleep 4 ) 9>"$WORK/.update.lock" &
sleep 0.5
rodar "deploy v1.74.0"
check "sai 75" test "$(rc)" = 75
check "não roda o update" test ! -e "$WORK/.args"
wait

if [ "$FAILS" != 0 ]; then echo "$FAILS falha(s)"; exit 1; fi
echo "OK"
