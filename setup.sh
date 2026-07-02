#!/usr/bin/env bash
# PTaaS — One-Shot Setup Script (macOS / Linux)
# Usage: bash setup.sh
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[PTaaS]${NC} $*"; }
success() { echo -e "${GREEN}[PTaaS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[PTaaS]${NC} $*"; }
die()     { echo -e "${RED}[PTaaS] ERROR:${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "======================================================"
echo "  PTaaS — Performance Testing as a Service"
echo "  One-Shot Installer"
echo "======================================================"
echo ""

# ── 1. OS Detection ───────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
info "Detected OS: $OS / $ARCH"

# ── 2. Homebrew (macOS) ───────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for Apple Silicon
    if [[ "$ARCH" == "arm64" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  else
    info "Homebrew already installed."
  fi
fi

# ── 3. Node.js (>= 18) ───────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(parseInt(process.version.slice(1))<18?1:0)' 2>/dev/null; echo $?)" == "1" ]]; then
  info "Installing Node.js 20 LTS..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install node@20
    brew link --overwrite node@20
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  info "Node.js $(node --version) already installed."
fi

# ── 4. PostgreSQL ─────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  info "Installing PostgreSQL..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install postgresql@16
    brew services start postgresql@16
    export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
  else
    sudo apt-get install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
  fi
else
  info "PostgreSQL already installed."
  if [[ "$OS" == "Darwin" ]]; then
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  fi
fi

sleep 2  # let postgres start

# ── 5. InfluxDB v2 ────────────────────────────────────────
if ! command -v influxd &>/dev/null; then
  info "Installing InfluxDB v2..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install influxdb
    brew services start influxdb
  else
    # Ubuntu/Debian
    wget -q https://repos.influxdata.com/influxdata-archive_compat.key
    echo '393e8779c89ac8d958f81f942f9ad7fb82a25e133faddaf92e15b16e6ac9ce4c influxdata-archive_compat.key' | sha256sum -c
    cat influxdata-archive_compat.key | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg > /dev/null
    echo 'deb [signed-by=/etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg] https://repos.influxdata.com/debian stable main' | sudo tee /etc/apt/sources.list.d/influxdata.list
    sudo apt-get update && sudo apt-get install -y influxdb2
    sudo systemctl start influxdb
    sudo systemctl enable influxdb
    rm -f influxdata-archive_compat.key
  fi
else
  info "InfluxDB already installed."
  if [[ "$OS" == "Darwin" ]]; then
    brew services start influxdb 2>/dev/null || true
  fi
fi

# ── 5a. Auto-provision InfluxDB (org/bucket/token) ─────────
# Root cause of the recurring "401 — check token and org" connectivity failure:
# influxd starts fresh/unauthenticated and any manually-copied token from the
# browser onboarding wizard drifts out of sync with backend/.env. Drive the
# same /api/v2/setup onboarding the wizard would, so the token we persist is
# always the one the running instance actually has.
INFLUX_ORG="PTaaS"
INFLUX_BUCKET="k6"
INFLUX_TOKEN=""

for i in $(seq 1 20); do
  curl -fsS http://localhost:8086/health >/dev/null 2>&1 && break
  sleep 1
done

SETUP_ALLOWED=$(curl -fsS http://localhost:8086/api/v2/setup 2>/dev/null | grep -o '"allowed":true' || true)
if [[ -n "$SETUP_ALLOWED" ]]; then
  info "Provisioning InfluxDB (org: $INFLUX_ORG, bucket: $INFLUX_BUCKET)..."
  INFLUX_ADMIN_PASS=$(openssl rand -base64 24 2>/dev/null || head -c 32 /dev/urandom | base64)
  SETUP_RESP=$(curl -fsS -X POST http://localhost:8086/api/v2/setup \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"${INFLUX_ADMIN_PASS}\",\"org\":\"${INFLUX_ORG}\",\"bucket\":\"${INFLUX_BUCKET}\"}" 2>/dev/null || true)
  INFLUX_TOKEN=$(echo "$SETUP_RESP" | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"$//')
  if [[ -n "$INFLUX_TOKEN" ]]; then
    success "InfluxDB provisioned — token captured automatically."
  else
    warn "InfluxDB setup call did not return a token: $SETUP_RESP"
  fi
else
  warn "InfluxDB already provisioned on this host — reusing existing backend/.env token if present."
fi

# ── 6. Grafana ────────────────────────────────────────────
if ! command -v grafana-server &>/dev/null && ! command -v grafana &>/dev/null; then
  info "Installing Grafana..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install grafana
    # Set custom port 9999 to avoid conflict with default 3000
    GRAFANA_CONF="$(brew --prefix)/etc/grafana/grafana.ini"
    if [[ -f "$GRAFANA_CONF" ]]; then
      sed -i.bak 's/^;http_port = 3000/http_port = 9999/' "$GRAFANA_CONF" 2>/dev/null || true
      sed -i.bak 's/^http_port = 3000/http_port = 9999/' "$GRAFANA_CONF" 2>/dev/null || true
    fi
    brew services start grafana
  else
    sudo apt-get install -y apt-transport-https software-properties-common
    wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/grafana.gpg > /dev/null
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
    sudo apt-get update && sudo apt-get install -y grafana
    sudo sed -i 's/^;http_port = 3000/http_port = 9999/' /etc/grafana/grafana.ini
    sudo systemctl start grafana-server
    sudo systemctl enable grafana-server
  fi
else
  info "Grafana already installed."
  if [[ "$OS" == "Darwin" ]]; then
    brew services start grafana 2>/dev/null || true
  fi
fi

# ── 7. K6 ─────────────────────────────────────────────────
if ! command -v k6 &>/dev/null && [[ ! -f "$HOME/bin/k6" ]]; then
  info "Installing K6..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install k6
  else
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update && sudo apt-get install -y k6
  fi
else
  info "K6 already installed."
fi

# ── 8. npm install (all workspaces) ───────────────────────
info "Installing Node dependencies..."
npm install

# ── 9. Environment Files ──────────────────────────────────
echo ""
echo "======================================================"
echo "  Configuration"
echo "======================================================"
echo ""

# ── 9a. Backend .env ──────────────────────────────────────
if [[ ! -f "backend/.env" ]]; then
  info "Creating backend/.env from template..."

  read -rp "  PostgreSQL user (default: $(whoami)): " PG_USER
  PG_USER="${PG_USER:-$(whoami)}"

  read -rp "  PostgreSQL password (leave blank if using peer auth on Mac): " PG_PASS
  if [[ -n "$PG_PASS" ]]; then
    PG_PASS_PART=":${PG_PASS}"
  else
    PG_PASS_PART=""
  fi

  read -rp "  PostgreSQL host (default: localhost): " PG_HOST
  PG_HOST="${PG_HOST:-localhost}"

  read -rp "  PostgreSQL database name (default: ptaas): " PG_DB
  PG_DB="${PG_DB:-ptaas}"

  read -rp "  Anthropic API key (sk-ant-...): " ANTHROPIC_KEY

  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  # InfluxDB org/bucket/token come from the auto-provisioning step above.
  if [[ -n "$INFLUX_TOKEN" ]]; then
    info "Using auto-provisioned InfluxDB token (org: $INFLUX_ORG, bucket: $INFLUX_BUCKET)."
  else
    warn "InfluxDB was not auto-provisioned — connectivity will show 401 until INFLUXDB_TOKEN is fixed."
    read -rp "  InfluxDB token (leave blank to configure later): " INFLUX_TOKEN
    INFLUX_TOKEN="${INFLUX_TOKEN:-CHANGE_ME}"
  fi

  cat > backend/.env <<EOF
DATABASE_URL="postgresql://${PG_USER}${PG_PASS_PART}@${PG_HOST}:5432/${PG_DB}"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"
ANTHROPIC_API_KEY="${ANTHROPIC_KEY}"
INFLUXDB_URL="http://localhost:8086"
INFLUXDB_TOKEN="${INFLUX_TOKEN}"
INFLUXDB_ORG="${INFLUX_ORG}"
INFLUXDB_BUCKET="${INFLUX_BUCKET}"
GRAFANA_URL="http://localhost:9999"
EOF
  success "backend/.env created."
else
  warn "backend/.env already exists — skipping."
fi

# ── 9b. Parse DATABASE_URL for db creation ────────────────
DB_URL=$(grep DATABASE_URL backend/.env | sed 's/DATABASE_URL="\(.*\)"/\1/')
# Extract db name from URL (last path segment)
DB_NAME=$(echo "$DB_URL" | sed 's|.*\/||' | tr -d '"')

# ── 10. Create PostgreSQL database ────────────────────────
info "Creating PostgreSQL database '${DB_NAME}' (if not exists)..."
if [[ "$OS" == "Darwin" ]]; then
  createdb "$DB_NAME" 2>/dev/null && success "Database '${DB_NAME}' created." || warn "Database '${DB_NAME}' already exists."
else
  sudo -u postgres createdb "$DB_NAME" 2>/dev/null && success "Database '${DB_NAME}' created." || warn "Database '${DB_NAME}' already exists."
fi

# ── 11. Prisma migrate ────────────────────────────────────
info "Running Prisma migrations..."
cd backend
npx prisma migrate dev --name init 2>/dev/null || npx prisma migrate deploy
cd "$SCRIPT_DIR"

# ── 12. Seed database ─────────────────────────────────────
info "Seeding database..."
cd backend
npm run db:seed 2>/dev/null || warn "Seed skipped (no seed data or already seeded)."
cd "$SCRIPT_DIR"

# ── 13. Register first user ───────────────────────────────
echo ""
echo "======================================================"
echo "  Create Admin User"
echo "======================================================"
read -rp "  Admin email (default: admin@perfops.dev): " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@perfops.dev}"
read -rp "  Admin name (default: Admin User): " ADMIN_NAME
ADMIN_NAME="${ADMIN_NAME:-Admin User}"
read -rsp "  Admin password (default: password123): " ADMIN_PASS
echo ""
ADMIN_PASS="${ADMIN_PASS:-password123}"

# Wait for backend to be ready — start it temporarily for registration
info "Starting backend temporarily to register admin user..."
cd backend
npm run dev &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# Poll until backend is up
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/config &>/dev/null; then break; fi
  sleep 1
done

REGISTER_RESP=$(curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\",\"name\":\"${ADMIN_NAME}\"}" 2>/dev/null || echo "{}")

echo "  Response: $REGISTER_RESP"

# ── 14. Register agent ────────────────────────────────────
if [[ ! -f "agent/.env" ]]; then
  info "Registering local agent..."
  AGENT_RESP=$(curl -s -X POST http://localhost:3001/api/agents/register \
    -H "Content-Type: application/json" \
    -d '{"name":"local-agent"}' 2>/dev/null || echo "{}")

  AGENT_ID=$(echo "$AGENT_RESP" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.agentId||o.agent?.id||'')}catch{console.log('')}})")
  AGENT_KEY=$(echo "$AGENT_RESP" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.apiKey||o.agent?.apiKey||'')}catch{console.log('')}})")

  if [[ -n "$AGENT_ID" && -n "$AGENT_KEY" ]]; then
    cat > agent/.env <<EOF
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="${AGENT_ID}"
AGENT_API_KEY="${AGENT_KEY}"
EOF
    success "agent/.env created (ID: ${AGENT_ID})."
  else
    warn "Could not auto-register agent. Create agent/.env manually."
    warn "POST http://localhost:3001/api/agents/register  body: {\"name\":\"local-agent\"}"
    cat > agent/.env <<EOF
CONTROL_PLANE_URL="http://localhost:3001"
AGENT_ID="CHANGE_ME"
AGENT_API_KEY="CHANGE_ME"
EOF
  fi
else
  warn "agent/.env already exists — skipping."
fi

# Stop temporary backend
kill $BACKEND_PID 2>/dev/null || true
wait $BACKEND_PID 2>/dev/null || true

# ── 15. Done ──────────────────────────────────────────────
echo ""
echo "======================================================"
echo -e "${GREEN}  PTaaS setup complete!${NC}"
echo "======================================================"
echo ""
echo "  Start the full stack:"
echo "    npm run dev              (frontend + backend)"
echo "    npm run agent:start      (in a separate terminal)"
echo ""
echo "  URLs:"
echo "    Frontend   → http://localhost:5173"
echo "    Backend    → http://localhost:3001"
echo "    InfluxDB   → http://localhost:8086  (auto-provisioned, org: ${INFLUX_ORG} / bucket: ${INFLUX_BUCKET})"
echo "    Grafana    → http://localhost:9999  (admin / admin)"
echo ""
echo "  Next steps:"
echo "    1. npm run dev  to start the app"
echo "    2. Log in at http://localhost:5173 with your admin credentials"
echo "    3. npm run agent:start  to connect the load-test agent"
echo ""
