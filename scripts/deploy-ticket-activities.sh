#!/usr/bin/env bash
# Native production deployment for the September 15 Scheduled Activities release.
set -Eeuo pipefail
umask 077

app=/opt/avidity/app
base=c083b199e6144fd0b128cc1cb62141fb73ed77c8
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo -i).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
for command in runuser node npm pg_dump pg_restore systemctl curl tar sha256sum; do
  command -v "$command" >/dev/null
done
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git rev-parse HEAD) == "$base" ]] || { echo 'Server revision differs from the reviewed base. Stop and inspect.'; exit 1; }
[[ -z $(as_app git status --porcelain) ]] || { echo 'Preserve and review server changes before deployment.'; exit 1; }
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
[[ $release != "$base" ]]
[[ -z $(as_app git diff --name-only "$base" "$release" -- package.json package-lock.json 'apps/*/package.json' 'packages/*/package.json') ]]
[[ $(as_app git diff --name-only "$base" "$release" -- prisma/migrations) == prisma/migrations/20260915140000_ticket_scheduled_activities/migration.sql ]] || { echo 'Unexpected migration scope.'; exit 1; }
systemctl is-active --quiet avidity-api
systemctl is-active --quiet avidity-web
[[ -f .env.production ]]
config_checksum=$(sha256sum .env.production)
artifacts=(apps/api/dist apps/web/.next packages/shared/dist packages/config/dist packages/ui/dist node_modules/.prisma/client)
for artifact in "${artifacts[@]}"; do [[ -d $artifact ]]; done

# Load configuration in a parent process, never through NODE_OPTIONS or shell eval.
configured() {
  as_app env -u NODE_OPTIONS node - "$@" <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
Object.assign(process.env, dotenv.parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
const [command, ...args] = process.argv.slice(2);
let result;
if (command === 'database-backup') {
  let url;
  try { url = new URL(process.env.DATABASE_URL); }
  catch { console.error("DATABASE_URL is missing or invalid; no backup was taken."); process.exit(1); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected PostgreSQL');
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '15' };
  if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  result = spawnSync('pg_dump', ['--no-password', '--format=custom', '--file', args[0]], { env, stdio: 'inherit' });
} else {
  result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
}
if (result.error) { console.error('Unable to execute deployment step:', command); process.exit(1); }
process.exit(result.status ?? 1);
NODE
}

# Check the old release's database state before introducing the new migration.
configured node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
backup=$(mktemp -d /opt/avidity/activities-backup.XXXXXXXX)
chown avidity:avidity "$backup"
printf '%s\n' "$base" > "$backup/previous-revision.txt"
as_app git archive --format=tar --output="$backup/source.tar" HEAD
printf 'Recovery directory: %s\n' "$backup"

# The previous application remains compatible with the additive database columns.
# Recovery restores code/artifacts only; it never rolls back or restores live data.
stopped=0
updated=0
saved=0
recover() {
  code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment interrupted. Recovery directory: $backup"
  if [[ $stopped == 1 ]]; then
    systemctl stop avidity-web avidity-api
    recovery_ok=1
    if [[ $updated == 1 ]]; then
      as_app git switch --detach "$base" || recovery_ok=0
      if [[ $saved == 1 ]]; then
        for artifact in "${artifacts[@]}"; do
          if [[ -e $artifact ]]; then
            mkdir -p "$backup/failed/$(dirname "$artifact")"
            mv "$artifact" "$backup/failed/$artifact" || recovery_ok=0
          fi
        done
        tar -xpf "$backup/runtime.tar" -C "$app" || recovery_ok=0
      fi
    fi
    if [[ $recovery_ok == 1 ]]; then
      systemctl start avidity-api avidity-web
      systemctl is-active avidity-api avidity-web
      echo 'Previous application restored. Verify health before further work; additive database changes are retained.'
    else
      echo 'Recovery needs manual inspection; services have been left stopped.'
    fi
  fi
  exit "${code:-1}"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web avidity-api
# Copy after stopping the services so the build/cache files cannot change mid-backup.
tar -cpf "$backup/runtime.tar" "${artifacts[@]}"
saved=1
configured database-backup "$backup/database.dump"
[[ -s $backup/database.dump ]]
pg_restore --list "$backup/database.dump" > "$backup/database-contents.txt"
[[ -z $(as_app git status --porcelain) ]]
updated=1
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
echo 'Next: validate Activities and an authorized Outlook/calendar pilot.'
