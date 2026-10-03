#!/bin/sh
# Prepara o usuario Unix dos agentes do autoconnector na VPS (rodar como root, uma vez).
#
# Por que: os agentes de IA (Claude Code, Codex) leem paginas de sites pedidos por qualquer
# pessoa e rodam Python com rede. Como `oghma`, eles conseguiriam ler /opt/oghma/.env
# (chaves do B2, banco, BRAIN_TOKEN). Como `oghma-agent`, so enxergam o worktree do pedido.
#
# Depois deste script, acrescente ao /opt/oghma/.env:
#   AUTOCONNECTOR_AGENT_USER=oghma-agent
#   AUTOCONNECTOR_AGENT_HOME=/var/lib/oghma-agent
# e reinicie: systemctl restart oghma-autoconnector
#
# Desfazer: tirar as duas linhas do .env, reiniciar o worker, `userdel -r oghma-agent`,
# apagar /etc/sudoers.d/oghma-agent e devolver a pasta ~/.codex ao oghma (passo 5 ao contrario).
set -eu

AGENT=oghma-agent
AGENT_HOME=/var/lib/oghma-agent
WORK=${AUTOCONNECTOR_WORK:-/srv/oghma-data/autoconnector}

# 1. Usuario e grupo do agente; o worker (oghma) entra no grupo para ler e escrever o que o agente cria.
id "$AGENT" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$AGENT_HOME" --shell /usr/sbin/nologin "$AGENT"
usermod -aG "$AGENT" oghma
chmod 2770 "$AGENT_HOME"
chgrp "$AGENT" "$AGENT_HOME"

# 2. O worker pode rodar comandos como o agente, sem senha (e nada alem disso).
cat > /etc/sudoers.d/oghma-agent <<EOF
oghma ALL=($AGENT) NOPASSWD: ALL
EOF
chmod 440 /etc/sudoers.d/oghma-agent
visudo -cf /etc/sudoers.d/oghma-agent

# 3. Worktrees dos pedidos: grupo do agente, gravavel pelo grupo, setgid nas pastas.
mkdir -p "$WORK"
chgrp -R "$AGENT" "$WORK"
chmod -R g+rwX "$WORK"
find "$WORK" -type d -exec chmod g+s {} +

# 4. /opt/oghma: o agente atravessa a pasta (venv, CLIs), mas nao lista nem le os segredos.
chmod 751 /opt/oghma
chmod 600 /opt/oghma/.env
chmod 700 /opt/oghma/.ssh
[ -f /opt/oghma/.claude.json ] && chmod 600 /opt/oghma/.claude.json
for dir in /opt/oghma/.claude /opt/oghma/.cache /opt/oghma/.npm; do [ -d "$dir" ] && chmod 700 "$dir"; done
chmod o+rx /opt/oghma/venv /opt/oghma/.local /opt/oghma/.local/bin 2>/dev/null || true

# 5. Login do Codex passa a ser do agente (move, para os dois nao renovarem o mesmo token).
if [ -d /opt/oghma/.codex ] && [ ! -d "$AGENT_HOME/.codex" ]; then
  mv /opt/oghma/.codex "$AGENT_HOME/.codex"
  chown -R "$AGENT:$AGENT" "$AGENT_HOME/.codex"
  chmod -R g+rX "$AGENT_HOME/.codex"   # o worker le ~/.codex/sessions para saber o uso do plano
fi

echo "Pronto. Teste: sudo -u oghma sudo -n -u $AGENT -- env HOME=$AGENT_HOME codex login status"
echo "Claude Code (opcional): sudo -u $AGENT -H /opt/oghma/.local/bin/claude  e depois /login"
