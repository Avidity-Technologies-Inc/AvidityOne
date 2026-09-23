#!/usr/bin/env bash
# Native production deployment for the ticket composer formatting and preferences release.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
base=d131af9ef48e7dd390711f2c09882e73f90de987
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
for command in runuser node npm pg_dump pg_restore systemctl curl tar sha256sum; do command -v "$command" >/dev/null; done
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git branch --show-current) == main ]] || { echo 'Expected main; stop and inspect.'; exit 1; }
[[ -z $(as_app git status --porcelain) ]] || { echo 'Preserve and review local server changes before deploying.'; exit 1; }
previous=$(as_app git rev-parse HEAD)
[[ $previous == "$base" || $previous == "$release" ]] || { echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1; }
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
as_app git merge-base --is-ancestor "$release" origin/main
[[ -z $(as_app git diff --name-only "$base" "$release" -- package.json package-lock.json 'apps/*/package.json' 'packages/*/package.json') ]] || { echo 'Unexpected dependency change; stop.'; exit 1; }
[[ $(as_app git diff --name-only "$base" "$release" -- prisma/migrations) == prisma/migrations/20260923190000_composer_preferences/migration.sql ]] || { echo 'Unexpected migration scope; stop.'; exit 1; }
[[ -f .env.production && -f apps/web/.next/BUILD_ID && -f apps/api/dist/main.js ]]
systemctl is-active --quiet avidity-api
systemctl is-active --quiet avidity-web
config_checksum=$(sha256sum .env.production)
artifacts=(apps/api/dist apps/web/.next packages/shared/dist packages/config/dist packages/ui/dist node_modules/.prisma/client)
for artifact in "${artifacts[@]}"; do [[ -d $artifact ]]; done
configured() {
  as_app env -u NODE_OPTIONS node - "$@" <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, require('dotenv').parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
const [command, ...args] = process.argv.slice(2);
let result;
if (command === 'database-backup') {
  let url;
  try { url = new URL(process.env.DATABASE_URL); }
  catch { console.error('DATABASE_URL is missing or invalid.'); process.exit(1); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) { console.error('Expected PostgreSQL.'); process.exit(1); }
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '15' };
  if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  result = spawnSync('pg_dump', ['--no-password', '--format=custom', '--file', args[0]], { env, stdio: 'inherit' });
} else result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
if (result.error) { console.error('Unable to execute deployment step:', command); process.exit(1); }
process.exit(result.status ?? 1);
NODE
}
# A retry after runtime recovery may have the new migration still pending.
if [[ $previous == "$base" ]]; then configured node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma; fi
backup=$(mktemp -d /opt/avidity/composer-preferences-backup.XXXXXXXX)
chown avidity:avidity "$backup"
printf '%s\n' "$previous" > "$backup/previous-checkout.txt"
as_app git archive HEAD > "$backup/source.tar"
echo "Recovery directory: $backup"
stopped=0
saved=0
recover() {
  code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment interrupted. Recovery directory: $backup"
  if [[ $stopped == 1 ]]; then
    systemctl stop avidity-web avidity-api || { echo 'Cannot stop services for recovery.'; exit 1; }
    if [[ $saved == 1 ]]; then
      for artifact in "${artifacts[@]}"; do
        if [[ -e $artifact ]]; then
          mkdir -p "$backup/failed/$(dirname "$artifact")" || exit 1
          mv "$artifact" "$backup/failed/$artifact" || exit 1
        fi
      done
      tar -xpf "$backup/runtime.tar" -C "$app" || { echo 'Recovery requires manual inspection; services remain stopped.'; exit 1; }
    fi
    systemctl start avidity-api avidity-web
    systemctl is-active avidity-api avidity-web
    echo 'Previous runtime restored. The additive preference columns are retained. Git remains at the attempted revision; verify health before retrying.'
  fi
  exit "$code"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web avidity-api
tar -cpf "$backup/runtime.tar" "${artifacts[@]}"
saved=1
configured database-backup "$backup/database.dump"
[[ -s $backup/database.dump ]]
pg_restore --list "$backup/database.dump" > "$backup/database-contents.txt"
[[ -z $(as_app git status --porcelain) ]]
as_app git merge --ff-only "$release"
configured node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
configured npm run prisma:generate
configured npm run build
[[ $(sha256sum .env.production) == "$config_checksum" ]]
systemctl start avidity-api avidity-web
for url in http://127.0.0.1:4000/api/health http://127.0.0.1:3000/login https://one.aviditytechnologies.com/api/health https://one.aviditytechnologies.com/login https://events.aviditytechnologies.com https://support.aviditytechnologies.com; do
  ready=0
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --location --max-time 10 "$url" -o /dev/null 2>/dev/null; then ready=1; break; fi
    sleep 2
  done
  [[ $ready == 1 ]] || { echo "Health check failed: $url"; false; }
  printf 'OK %s\n' "$url"
done
systemctl is-active --quiet avidity-api
systemctl is-active --quiet avidity-web
[[ $(as_app git rev-parse HEAD) == "$release" ]]
[[ -z $(as_app git status --porcelain) ]]
trap - ERR INT TERM
printf 'Deployment complete: %s\nRecovery directory: %s\n' "$release" "$backup"
echo 'Next: verify Settings > Ticket Composer, Profile > Ticket Writing, and the ticket composer. No test email has been sent by this script.'
