#!/usr/bin/env bash
# Liga o deploy automático da VPS da TOQ (workflow .github/workflows/deploy-vps.yml).
#
# Roda UMA vez, no PC que já entra na VPS com `ssh toq-vps` e tem o `gh` logado
# na conta dona do repositório:
#
#   bash infra/toq-vps/configurar-deploy-automatico.sh
#
# O que faz, em ordem:
#   1. gera uma chave SSH nova, só de deploy, numa pasta temporária;
#   2. instala na VPS o comando forçado (~/.local/bin/toq-deploy-por-ssh) e põe a
#      chave pública no authorized_keys amarrada a ele (`command=…,restrict`);
#   3. prova que a chave entra e que NÃO ganha shell (pedido inválido → recusado);
#   4. grava os secrets VPS_SSH_KEY, VPS_KNOWN_HOSTS, VPS_HOST, VPS_USER e
#      VPS_PORT no repositório com `gh secret set`;
#   5. apaga a chave privada local. Ela só existe nos secrets do GitHub.
#
# NÃO liga o deploy: isso é a variável DEPLOY_VPS=ligado, que o script oferece
# no fim (ou `gh variable set DEPLOY_VPS --body ligado -R <repo>` depois).
# Rodar de novo troca a chave (a antiga sai do authorized_keys).
set -euo pipefail

ALVO="${ALVO_SSH:-toq-vps}"
REPO="${REPO_GITHUB:-pedroaccastilho/DeskcommCRM}"
COMENTARIO="deploy-github-actions-${REPO//\//-}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
erro() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || erro "falta o GitHub CLI (no CachyOS: sudo pacman -S github-cli; depois gh auth login)"
gh auth status >/dev/null 2>&1 || erro "o gh não está logado. Rode: gh auth login"
gh repo view "$REPO" >/dev/null 2>&1 || erro "o gh não enxerga o repositório $REPO"
ssh -o BatchMode=yes "$ALVO" true || erro "não consegui entrar com 'ssh $ALVO'"
ok "gh e ssh $ALVO funcionando"

# Endereço, usuário e porta reais por trás do apelido do ~/.ssh/config.
HOST="$(ssh -G "$ALVO" | awk '$1=="hostname"{print $2; exit}')"
USUARIO="$(ssh -G "$ALVO" | awk '$1=="user"{print $2; exit}')"
PORTA="$(ssh -G "$ALVO" | awk '$1=="port"{print $2; exit}')"
PROJETO="$(ssh "$ALVO" 'cd ~/deskcommcrm && pwd')" || erro "não achei ~/deskcommcrm na VPS"
CASA="$(ssh "$ALVO" 'printf %s "$HOME"')"
ok "VPS: ${USUARIO}@${HOST}:${PORTA}, projeto em ${PROJETO}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Host key: o que a VPS apresenta agora TEM de ser o que este PC já confia.
ssh-keyscan -p "$PORTA" -t ed25519 "$HOST" 2>/dev/null >"$TMP/known_hosts"
[ -s "$TMP/known_hosts" ] || erro "ssh-keyscan não trouxe a chave da VPS"
lida="$(ssh-keygen -lf "$TMP/known_hosts" | awk '{print $2}')"
alvo_kh="$HOST"; [ "$PORTA" = "22" ] || alvo_kh="[$HOST]:$PORTA"
ssh-keygen -F "$alvo_kh" -l 2>/dev/null | grep -qF "$lida" \
  || erro "a chave que a VPS apresentou ($lida) não é a que este PC conhece em ~/.ssh/known_hosts. Parei."
ok "host key da VPS conferida ($lida)"

ssh-keygen -q -t ed25519 -N "" -C "$COMENTARIO" -f "$TMP/chave"
PUB="$(cat "$TMP/chave.pub")"

# Comando forçado fora do repositório: não muda quando o update.sh troca a versão.
ssh "$ALVO" 'mkdir -p ~/.local/bin && cat > ~/.local/bin/toq-deploy-por-ssh && chmod 755 ~/.local/bin/toq-deploy-por-ssh' \
  <"$AQUI/deploy-por-ssh.sh"
LINHA="command=\"${CASA}/.local/bin/toq-deploy-por-ssh ${PROJETO}\",restrict ${PUB}"
# shellcheck disable=SC2029 # LINHA e COMENTARIO expandem aqui de propósito
ssh "$ALVO" "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; \
  grep -vF '${COMENTARIO}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.novo || true; \
  printf '%s\n' '${LINHA}' >> ~/.ssh/authorized_keys.novo; \
  mv ~/.ssh/authorized_keys.novo ~/.ssh/authorized_keys"
ok "chave de deploy instalada na VPS (só aceita 'deploy vX.Y.Z')"

# Prova: a chave entra, e um pedido qualquer é recusado pelo comando forçado.
set +e
saida="$(ssh -i "$TMP/chave" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$TMP/known_hosts" \
  -p "$PORTA" "${USUARIO}@${HOST}" "whoami" 2>&1)"
codigo=$?
set -e
[ "$codigo" = 64 ] || erro "a chave nova não se comportou como esperado (saída $codigo: $saida)"
ok "chave nova entra e não ganha shell (pedido 'whoami' recusado)"

gh secret set VPS_SSH_KEY -R "$REPO" <"$TMP/chave"
gh secret set VPS_KNOWN_HOSTS -R "$REPO" <"$TMP/known_hosts"
gh secret set VPS_HOST -R "$REPO" --body "$HOST"
gh secret set VPS_USER -R "$REPO" --body "$USUARIO"
gh secret set VPS_PORT -R "$REPO" --body "$PORTA"
ok "secrets gravados em $REPO (a chave privada local é apagada agora)"

printf '\nLigar o deploy automático agora (DEPLOY_VPS=ligado)? [s/N] '
read -r resp || resp=""
case "$resp" in
  s|S|sim|SIM)
    gh variable set DEPLOY_VPS -R "$REPO" --body ligado
    ok "deploy automático LIGADO: a próxima Release publicada vai sozinha para a VPS" ;;
  *)
    echo "Deixei desligado. Para ligar depois: gh variable set DEPLOY_VPS --body ligado -R $REPO" ;;
esac
