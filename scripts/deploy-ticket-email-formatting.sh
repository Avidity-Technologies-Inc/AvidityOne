#!/usr/bin/env bash
# API and web deployment for the September 18 ticket email formatting fix.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git branch --show-current) == main ]] || { echo 'Expected main; inspect the server branch before proceeding.'; exit 1; }
[[ -z $(as_app git status --porcelain) ]] || { echo 'Server has local changes; preserve and review them first.'; exit 1; }
previous=$(as_app git rev-parse HEAD)
case "$previous" in
  409a48b0138b313744286e39c6395e5226e66023|43a5222eb4d6bb3681876f8d3bc5c1fc06be8332|3060467efe02e0221c143c5e1e1321b6ae7417c7|"$release") ;;
  *) echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1 ;;
esac
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$previous" "$release"
# Recovery restores compiled API/web artifacts; dependencies and database remain unchanged.
[[ -z $(as_app git diff --name-only "$previous" "$release" -- packages prisma package.json package-lock.json 'apps/*/package.json' apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json apps/web/next.config.mjs apps/web/public) ]] || { echo 'Changes require a different deployment procedure.'; exit 1; }
[[ -f .env.production && -f apps/web/.next/BUILD_ID && -f apps/api/dist/main.js ]]
systemctl is-active --quiet avidity-web
systemctl is-active --quiet avidity-api
config_checksum=$(sha256sum .env.production)
backup=$(mktemp -d /opt/avidity/email-formatting-backup.XXXXXXXX)
printf '%s\n' "$previous" > "$backup/previous-checkout.txt"
as_app git archive HEAD > "$backup/source.tar"
echo "Recovery directory: $backup"
stopped=0
saved=0
recover() {
  code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment failed. Recovery directory: $backup"
  if [[ $stopped == 1 ]]; then
    systemctl stop avidity-web avidity-api || { echo 'Unable to stop services for recovery.'; exit 1; }
    if [[ $saved == 1 ]]; then
      mkdir -p "$backup/failed/apps/api" "$backup/failed/apps/web" || exit 1
      for artifact in apps/api/dist apps/web/.next; do
        if [[ -e $artifact ]]; then
          mv "$artifact" "$backup/failed/$artifact" || { echo 'Unable to preserve failed build; inspect before restarting.'; exit 1; }
        fi
      done
      tar -xpf "$backup/runtime.tar" -C "$app" || { echo 'Unable to restore previous builds; services remain stopped.'; exit 1; }
    fi
    systemctl start avidity-api avidity-web
    systemctl is-active avidity-api avidity-web
    echo 'Previous runtime restored. Git remains at the attempted revision; inspect health and resolve the failure before retrying.'
  fi
  exit "$code"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web avidity-api
tar -cpf "$backup/runtime.tar" apps/api/dist apps/web/.next
saved=1
as_app git merge --ff-only "$release"
as_app env -u NODE_OPTIONS node <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, require('dotenv').parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
for (const script of ['build:api', 'build:web']) {
  const result = spawnSync('npm', ['run', script], { env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('Build failed:', script);
    process.exit(result.status ?? 1);
  }
}
NODE
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
systemctl is-active --quiet avidity-web
systemctl is-active --quiet avidity-api
[[ $(as_app git rev-parse HEAD) == "$release" ]]
[[ -z $(as_app git status --porcelain) ]]
trap - ERR INT TERM
printf 'Deployment complete: %s\nRecovery directory: %s\n' "$release" "$backup"
