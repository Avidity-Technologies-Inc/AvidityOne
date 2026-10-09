#!/usr/bin/env bash
# Native production deployment for the reviewed security dependency update.
set -Eeuo pipefail
umask 077
app=/opt/avidity/app
base=489792fff703ed916dc90c27b1542a01955c9857
recovered_release=14ade61657bd5f0f7a5057c48efa47e139fcaad1
release=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ $release =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply the full published release SHA.'; exit 1; }
[[ $(hostname -s) == avidityhelpdesk ]] || { echo 'Unexpected host; inspect before proceeding.'; exit 1; }
cd "$app"
for command in runuser node npm systemctl curl tar sha256sum du df; do command -v "$command" >/dev/null; done
as_app() { runuser -u avidity -- "$@"; }
[[ $(as_app git rev-parse --show-toplevel) == "$app" ]]
[[ $(as_app git branch --show-current) == main ]] || { echo 'Expected main; stop and inspect.'; exit 1; }
remote=$(as_app git remote get-url origin)
[[ $remote == git@github.com:Avidity-Technologies-Inc/AvidityOne.git || $remote == https://github.com/Avidity-Technologies-Inc/AvidityOne.git ]] || { echo 'Unexpected origin; stop and inspect.'; exit 1; }
previous=$(as_app git rev-parse HEAD)
[[ $previous == "$base" || $previous == "$recovered_release" || $previous == "$release" ]] || { echo "Unreviewed server revision: $previous. Stop and inspect."; exit 1; }
as_app git cat-file -e "$release^{commit}"
as_app git merge-base --is-ancestor "$base" "$release"
as_app git merge-base --is-ancestor "$release" origin/main
generated_recovery=0
working_changes=$(as_app git status --porcelain)
if [[ -n $working_changes ]]; then
  # Recover only the exact Next-generated change verified after the previous rollback.
  # Any other local edit, index change or untracked file still blocks deployment.
  [[ $previous == "$recovered_release" && $working_changes == ' M apps/web/next-env.d.ts' ]] || { echo 'Preserve and review local server changes before deploying.'; exit 1; }
  cmp -s apps/web/next-env.d.ts <(as_app git show "$release:apps/web/next-env.d.ts") || { echo 'Unexpected Next declaration contents; stop and inspect.'; exit 1; }
  generated_recovery=1
fi
[[ -z $(as_app git diff --name-only "$base" "$release" -- prisma/schema.prisma prisma/migrations) ]] || { echo 'This dependency deployment cannot apply schema changes.'; exit 1; }
# The patched HTML parser requires Node >=22.12. Check before stopping services.
as_app node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node >=22.12 is required. Stop and plan a runtime update first."); process.exit(1); }'
[[ -f .env.production && -f apps/web/.next/BUILD_ID && -f apps/api/dist/main.js ]]
systemctl is-active --quiet avidity-api
systemctl is-active --quiet avidity-web
config_checksum=$(sha256sum .env.production)
artifacts=(apps/api/dist apps/web/.next packages/shared/dist packages/config/dist packages/ui/dist node_modules)
for artifact in "${artifacts[@]}"; do [[ -d $artifact ]]; done
shopt -s nullglob
for artifact in apps/*/node_modules packages/*/node_modules; do artifacts+=("$artifact"); done
# Keep enough space for the complete old runtime plus a replacement installation.
size_kb=$(du -sk "${artifacts[@]}" | awk '{sum += $1} END {print sum}')
free_kb=$(df -Pk "$app" | awk 'END {print $4}')
(( free_kb > size_kb * 2 + 524288 )) || { echo 'Insufficient free disk space for dependency backup and replacement.'; exit 1; }
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
# Database inspection only: this release has no migrations.
configured node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
backup=$(mktemp -d /opt/avidity/security-dependencies-backup.XXXXXXXX)
chown avidity:avidity "$backup"
printf '%s\n' "$previous" > "$backup/previous-checkout.txt"
as_app git archive HEAD > "$backup/source.tar"
if [[ $generated_recovery == 1 ]]; then
  cp -p apps/web/next-env.d.ts "$backup/next-env.generated.d.ts"
  as_app git diff -- apps/web/next-env.d.ts > "$backup/next-env.generated.patch"
  as_app git restore --source=HEAD --worktree -- apps/web/next-env.d.ts
fi
echo "Recovery directory: $backup"
stopped=0
saved=0
recover() {
  code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment interrupted at line ${1:-unknown}. Recovery directory: $backup"
  if [[ $stopped == 1 ]]; then
    systemctl stop avidity-web avidity-api || { echo 'Cannot stop services for recovery.'; exit 1; }
    if [[ $saved == 1 ]]; then
      recovery_artifacts=(apps/api/dist apps/web/.next packages/shared/dist packages/config/dist packages/ui/dist node_modules apps/*/node_modules packages/*/node_modules)
      for artifact in "${recovery_artifacts[@]}"; do
        if [[ -e $artifact ]]; then
          mkdir -p "$backup/failed/$(dirname "$artifact")" || exit 1
          mv "$artifact" "$backup/failed/$artifact" || exit 1
        fi
      done
      tar -xpf "$backup/runtime.tar" -C "$app" || { echo 'Recovery requires manual inspection; services remain stopped.'; exit 1; }
    fi
    systemctl start avidity-api avidity-web
    systemctl is-active avidity-api avidity-web
    echo 'Previous build and all dependencies restored. Git remains at the attempted revision; verify health before retrying.'
  fi
  exit "$code"
}
trap 'recover "$LINENO"' ERR
trap 'false' INT TERM
stopped=1
systemctl stop avidity-web avidity-api
tar -cpf "$backup/runtime.tar" "${artifacts[@]}"
saved=1
[[ -z $(as_app git status --porcelain) ]]
as_app git merge --ff-only "$release"
configured npm ci --include=dev --no-audit --no-fund
configured node scripts/check-security-dependencies.cjs
configured npm run prisma:generate
configured npm run build
configured node scripts/check-device-identity-schema.cjs
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
[[ -z $(as_app git status --porcelain) ]] || { echo 'Unexpected working-tree change after build:'; as_app git status --short; false; }
trap - ERR INT TERM
printf 'Deployment complete: %s\nRecovery directory: %s\n' "$release" "$backup"
echo 'No database migrations, operating-system packages, service definitions, or environment settings were changed.'
