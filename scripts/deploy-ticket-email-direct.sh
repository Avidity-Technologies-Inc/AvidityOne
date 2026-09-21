#!/usr/bin/env bash
# Native API/web deployment for direct ticket email replies; no database or configuration changes.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
base=daedfde4a616d1c2804bb017ee54021fcb4a16ff
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
for command in runuser node npm git systemctl curl sha256sum mktemp mv; do command -v "$command" >/dev/null; done
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git branch --show-current) == main ]] || { echo 'Expected main; inspect the server branch before proceeding.'; exit 1; }
[[ -z $(as_app git status --porcelain) ]] || { echo 'Server has local changes; preserve and review them first.'; exit 1; }
previous=$(as_app git rev-parse HEAD)
case "$previous" in
  "$base"|"$release") ;;
  *) echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1 ;;
esac
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
as_app git merge-base --is-ancestor "$release" origin/main
# Recovery relies on unchanged dependencies, schema and shared runtime packages.
[[ -z $(as_app git diff --name-only "$base" "$release" -- packages prisma package.json package-lock.json apps/api/package.json apps/web/package.json) ]] || { echo 'Unexpected schema, shared package or dependency change.'; exit 1; }
[[ -f .env.production && -f apps/api/dist/main.js && -f apps/web/.next/BUILD_ID ]]
systemctl is-active --quiet avidity-web
systemctl is-active --quiet avidity-api
for url in http://127.0.0.1:4000/api/health http://127.0.0.1:3000/login; do
  curl --fail --silent --show-error --max-time 15 "$url" -o /dev/null || { echo "Pre-deployment health check failed: $url"; exit 1; }
done
config_checksum=$(sha256sum .env.production)
backup=$(mktemp -d /opt/avidity/ticket-email-direct-backup.XXXXXXXX)
printf '%s\n' "$previous" > "$backup/previous-checkout.txt"
as_app git archive HEAD > "$backup/source.tar"
echo "Recovery directory: $backup"
stopped=0
saved=0
web_saved=0
recover() {
  code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment failed. Recovery directory: $backup"
  if [[ $stopped == 1 ]]; then
    systemctl stop avidity-web avidity-api || { echo 'Unable to stop services for recovery; inspect before restoring runtime.'; exit 1; }
    if [[ $saved == 1 ]]; then
      if [[ -e apps/api/dist ]]; then
        mv apps/api/dist "$backup/failed-api" || { echo 'Unable to preserve failed build; inspect before restarting.'; exit 1; }
      fi
      mv "$backup/api-dist" apps/api/dist || { echo 'Unable to restore previous build; service remains stopped.'; exit 1; }
    fi
    if [[ $web_saved == 1 ]]; then
      if [[ -e apps/web/.next ]]; then mv apps/web/.next "$backup/failed-web" || exit 1; fi
      mv "$backup/web-next" apps/web/.next || { echo 'Unable to restore previous web build.'; exit 1; }
    fi
    systemctl start avidity-api avidity-web
    systemctl is-active avidity-api avidity-web
    echo 'Previous runtime restored. Git remains at the attempted revision; rerun this deployment after resolving the failure.'
  fi
  exit "$code"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
# The live web unit Requires=avidity-api.service; stopping API also stops web.
# Manage the pair explicitly for deployment and recovery.
systemctl stop avidity-web avidity-api
mv apps/api/dist "$backup/api-dist"
saved=1
mv apps/web/.next "$backup/web-next"
web_saved=1
as_app git merge --ff-only "$release"
as_app env -u NODE_OPTIONS node <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, require('dotenv').parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
for (const task of ['build:api', 'build:web']) {
  const result = spawnSync('npm', ['run', task], { env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error('Build failed:', task); process.exit(result.status || 1); }
}
NODE
[[ -f apps/api/dist/main.js && -f apps/web/.next/BUILD_ID ]]
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
echo 'Existing notification settings are retained. New replies execute directly when existing email-reply/close settings permit. Legacy confirmations and uncertain actions are not replayed. No test email was sent.'
