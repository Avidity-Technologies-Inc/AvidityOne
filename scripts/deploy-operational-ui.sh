#!/usr/bin/env bash
# Native production deployment for the operational accuracy and interface refinement release.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
base=f0a6ca1a2e62e6007af0f1c3063b1171bd453130
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
for command in runuser node npm systemctl curl tar sha256sum; do command -v "$command" >/dev/null; done
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git branch --show-current) == main ]] || { echo 'Expected main; stop and inspect.'; exit 1; }
[[ -z $(as_app git status --porcelain) ]] || { echo 'Preserve and review local server changes before deploying.'; exit 1; }
previous=$(as_app git rev-parse HEAD)
[[ $previous == "$base" || $previous == 677b069d495f13199627ff23c64f66e19ea3a899 || $previous == "$release" ]] || { echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1; }
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
as_app git merge-base --is-ancestor "$release" origin/main
[[ -z $(as_app git diff --name-only "$base" "$release" -- package.json package-lock.json 'apps/*/package.json' 'packages/*/package.json') ]] || { echo 'Unexpected dependency change; stop.'; exit 1; }
[[ -z $(as_app git diff --name-only "$base" "$release" -- prisma) ]] || { echo 'Unexpected schema or migration change; stop.'; exit 1; }
[[ -f .env.production && -f apps/web/.next/BUILD_ID && -f apps/api/dist/main.js ]]
systemctl is-active --quiet avidity-api
systemctl is-active --quiet avidity-web
config_checksum=$(sha256sum .env.production)
artifacts=(apps/api/dist apps/web/.next packages/shared/dist packages/config/dist packages/ui/dist)
for artifact in "${artifacts[@]}"; do [[ -d $artifact ]]; done
configured() {
  as_app env -u NODE_OPTIONS node - "$@" <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, require('dotenv').parse(fs.readFileSync('.env.production')));
delete process.env.NODE_OPTIONS;
process.env.NODE_ENV = 'production';
const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
if (result.error) { console.error('Unable to execute deployment step:', command); process.exit(1); }
process.exit(result.status ?? 1);
NODE
}
# Verify the already-installed schema before stopping services. This release applies no migrations.
configured node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
backup=$(mktemp -d /opt/avidity/operational-ui-backup.XXXXXXXX)
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
    echo 'Previous runtime restored. Database and environment were not modified. Git remains at the attempted revision; verify health before retrying.'
  fi
  exit "$code"
}
trap recover ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web avidity-api
tar -cpf "$backup/runtime.tar" "${artifacts[@]}"
saved=1
[[ -z $(as_app git status --porcelain) ]]
as_app git merge --ff-only "$release"
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
echo 'Next: verify Dashboard, Operations, Clients, Devices, Events, QC and public forms. No business records or activation settings were changed by this script.'
