#!/bin/bash
set -euo pipefail

# Deploy ant-adsb-radar to a Docker host over SSH (rsync + docker compose).
#
#   DEPLOY_HOST=user@host ./deploy.sh --deploy
#
# DEPLOY_HOST is the ssh destination (key-based login, passwordless
# `sudo docker` there); REMOTE_DIR is the checkout directory on the host
# (default /opt/ant-adsb-radar). Both can also live in a local `.deploy.env`
# (gitignored) so you don't retype them.
#
# The runtime .env on the host is NOT managed here: this script never writes
# it, so a copy you maintain on the host (or one rendered by the GitHub
# Actions deploy workflow) survives every sync. Create it from .env.example.
if [ -f .deploy.env ]; then
    # shellcheck disable=SC1091
    . ./.deploy.env
fi
HOST="${DEPLOY_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ant-adsb-radar}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    echo "Usage: DEPLOY_HOST=user@host $0 [OPTION]"
    echo "  --deploy     Sync code to the host, build + start containers"
    echo "  --status     docker compose ps on the host"
    echo "  --logs       Tail all logs"
    echo "  --logs-be    Tail backend logs"
    echo "  --logs-fe    Tail frontend logs"
    echo "  --stop       docker compose down"
    echo "  --restart    docker compose restart"
    echo "  --verify     Check deployed version matches local HEAD"
    echo "  --help       Show this help"
}

require_host() {
    if [ -z "${HOST}" ]; then
        echo -e "${RED}Error: DEPLOY_HOST is not set.${NC}" >&2
        echo "Set it in the environment or in .deploy.env, e.g. DEPLOY_HOST=pi@radar-host" >&2
        exit 1
    fi
}

sync_code() {
    echo -e "${GREEN}Syncing code to ${HOST}:${REMOTE_DIR}...${NC}"
    # /opt needs root to create; hand ownership to the deploy user so rsync/
    # compose can write without sudo thereafter.
    ssh "${HOST}" "sudo mkdir -p ${REMOTE_DIR} && sudo chown \$(id -un):\$(id -gn) ${REMOTE_DIR}"
    # .env is excluded deliberately: it is host state. rsync --delete leaves
    # excluded files alone, so the host's copy survives this sync.
    rsync -avz --delete \
        --exclude '.env' \
        --exclude '.deploy.env' \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '.svelte-kit' \
        --exclude 'build' \
        --exclude '__pycache__' \
        --exclude '.venv' \
        --exclude '.claude' \
        ./ "${HOST}:${REMOTE_DIR}/"
}

require_env() {
    if ssh "${HOST}" "test -f ${REMOTE_DIR}/.env" 2>/dev/null; then
        return 0
    fi
    echo -e "${RED}Error: ${REMOTE_DIR}/.env is missing on ${HOST}.${NC}" >&2
    echo "Create it on the host from .env.example (READSB_URL, PUBLIC_API_URL, ORIGIN, ...)." >&2
    exit 1
}

deploy() {
    require_env
    sync_code
    local commit
    commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo -e "${GREEN}Building + starting containers on ${HOST} (commit ${commit})...${NC}"
    ssh "${HOST}" "cd ${REMOTE_DIR} && sudo env GIT_COMMIT=${commit} docker compose build && sudo env GIT_COMMIT=${commit} docker compose up -d --remove-orphans"
    echo -e "${GREEN}=== Deployment complete ===${NC}"
    status
}

status()  { ssh "${HOST}" "cd ${REMOTE_DIR} && sudo docker compose ps"; }
stop()    { ssh "${HOST}" "cd ${REMOTE_DIR} && sudo docker compose down"; }
restart() { ssh "${HOST}" "cd ${REMOTE_DIR} && sudo docker compose restart"; status; }
logs()    { ssh "${HOST}" "cd ${REMOTE_DIR} && sudo docker compose logs -f ${1:-}"; }

verify() {
    local expected
    expected="$(git rev-parse --short HEAD)"
    sleep 8
    local deployed
    deployed=$(ssh "${HOST}" "curl -sf http://localhost:8001/api/health" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4) || deployed="unreachable"
    if [ "$deployed" = "$expected" ]; then
        echo -e "${GREEN}${HOST}: ${deployed} ✓${NC}"
    else
        echo -e "${RED}${HOST}: ${deployed} (expected ${expected}) ✗${NC}"
    fi
}

[ $# -eq 0 ] && { usage; exit 1; }
case "$1" in
    --help)    usage; exit 0 ;;
esac
require_host
case "$1" in
    --deploy)  deploy ;;
    --status)  status ;;
    --logs)    logs "" ;;
    --logs-be) logs "backend" ;;
    --logs-fe) logs "frontend" ;;
    --stop)    stop ;;
    --restart) restart ;;
    --verify)  verify ;;
    *)         echo -e "${RED}Unknown option: $1${NC}"; usage; exit 1 ;;
esac
