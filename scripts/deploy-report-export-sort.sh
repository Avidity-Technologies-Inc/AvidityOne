#!/usr/bin/env bash
# Web-only deployment for report export row-order controls.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
base=60ae53cf1388c2069aae7cbf8c5deefcd740a08f
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
  "$base"|"$release") ;;
  *) echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1 ;;
esac
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
as_app git merge-base --is-ancestor "$release" origin/main
# Recovery relies on the previous Next build remaining compatible with its runtime.
[[ -z $(as_app git diff --name-only "$base" "$release" -- apps/api packages prisma package.json package-lock.json apps/web/package.json apps/web/next.config.mjs apps/web/public) ]] || { echo 'Changes exceed a web-only deployment.'; exit 1; }
[[ -f .env.production && -f apps/web/.next/BUILD_ID ]]
systemctl is-active --quiet avidity-web
systemctl is-active --quiet avidity-api
config_checksum=$(sha256sum .env.production)
backup=$(mktemp -d /opt/avidity/report-export-sort-backup.XXXXXXXX)
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
    systemctl stop avidity-web
    if [[ $saved == 1 ]]; then
      if [[ -e apps/web/.next ]]; then
        mv apps/web/.next "$backup/failed-next" || { echo 'Unable to preserve failed build; inspect before restarting.'; exit 1; }
      fi
      mv "$backup/next" apps/web/.next || { echo 'Unable to restore previous build; service remains stopped.'; exit 1; }
    fi
    systemctl start avidity-web
    systemctl is-active avidity-web
    echo 'Previous web build restored. Git remains at the attempted revision; rerun this deployment after resolving the failure.'
  fi
  exit "$code"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web
mv apps/web/.next "$backup/next"
saved=1
as_app git merge --ff-only "$release"
as_app env -u NODE_OPTIONS node <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, require('dotenv').parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
const result = spawnSync('npm', ['run', 'build:web'], { env: process.env, stdio: 'inherit' });
if (result.error) console.error('Unable to start the web build.');
process.exit(result.status ?? 1);
NODE
[[ $(sha256sum .env.production) == "$config_checksum" ]]
systemctl start avidity-web
for url in http://127.0.0.1:3000/login https://one.aviditytechnologies.com/api/health https://one.aviditytechnologies.com/login https://events.aviditytechnologies.com https://support.aviditytechnologies.com; do
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
