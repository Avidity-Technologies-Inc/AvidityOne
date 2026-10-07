"""Validate additive migration backup and runtime recovery without touching real services."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_ticket_email_direct import STUB as ORIGINAL_STUB
ROOT = Path(__file__).resolve().parents[2]
STUB = ORIGINAL_STUB.replace("elif args[0] == 'merge':", "elif args[0] == 'diff' and 'prisma/migrations' in args: print('prisma/migrations/20261007140000_qc_operational_follow_up/migration.sql')\n    elif args[0] == 'merge':")
STUB = STUB.replace("    output = root / 'app/apps/api/dist'", "    if 'database-backup' in args:\n        pathlib.Path(args[-1]).write_text('synthetic database backup')\n        sys.exit(8 if os.environ.get('DEPLOY_TEST_FAILURE') == 'backup' else 0)\n    if 'migrate' in args: sys.exit(8 if 'deploy' in args and os.environ.get('DEPLOY_TEST_FAILURE') == 'migration' else 0)\n    if 'prisma:generate' in args: sys.exit(0)\n    output = root / 'app/apps/api/dist'")
STUB = STUB.replace("elif name in ('sleep', 'npm'): pass", "elif name in ('sleep', 'npm', 'pg_dump', 'pg_restore', 'chown'): pass")
STUB = STUB.replace("    output = root / 'app/apps/api/dist'", "    if any(arg.endswith('check-qc-operations-schema.cjs') for arg in args): sys.exit(8 if os.environ.get('DEPLOY_TEST_FAILURE') == 'schema' else 0)\n    output = root / 'app/apps/api/dist'")
STUB = STUB.replace("elif args[0] == 'branch':", "elif args[0] == 'remote': print('git@github.com:Avidity-Technologies-Inc/AvidityOne.git')\n    elif args[0] == 'branch':")
class QcOperationsDeploymentTests(unittest.TestCase):
    def deploy(self, failure=''):
        with tempfile.TemporaryDirectory(prefix='avidity-composer-deploy-test-') as directory:
            root = Path(directory); app = root / 'app'; bins = root / 'bin'; bins.mkdir()
            for artifact in ['apps/api/dist', 'apps/web/.next', 'packages/shared/dist', 'packages/config/dist', 'packages/ui/dist', 'node_modules/.prisma/client']:
                folder = app / artifact; folder.mkdir(parents=True); (folder / 'preserved').write_text('old artifact')
            (app / 'apps/api/dist/main.js').write_text('old runtime')
            (app / 'apps/web/.next/BUILD_ID').write_text('old web')
            (app / '.env.production').write_text('SYNTHETIC_TEST=1\n')
            state_file = root / 'state.json'; state_file.write_text(json.dumps({'head': 'd5049328c22fb1b1d3e17f795bc7c5b1872bc00a', 'avidity-api': True, 'avidity-web': True}))
            for name in ('hostname', 'runuser', 'git', 'systemctl', 'node', 'curl', 'sleep', 'npm', 'pg_dump', 'pg_restore', 'chown'):
                target = bins / name; target.write_text(STUB); target.chmod(0o755)
            script = (ROOT / 'scripts/deploy-qc-operations.sh').read_text().replace('app=/opt/avidity/app', f'app={app}').replace('/opt/avidity/qc-operations-backup.', f'{root}/backup.').replace("[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }", ': # isolated test')
            target = root / 'deploy.sh'; target.write_text(script)
            result = subprocess.run(['bash', str(target), 'a' * 40], env={**os.environ, 'PATH': f'{bins}:{os.environ["PATH"]}', 'DEPLOY_TEST_ROOT': str(root), 'DEPLOY_TEST_FAILURE': failure}, capture_output=True, text=True, timeout=30)
            state = json.loads(state_file.read_text())
            self.assertTrue(state['avidity-api'] and state['avidity-web'], result.stdout + result.stderr)
            self.assertEqual((app / 'apps/api/dist/main.js').read_text(), 'old runtime' if failure else 'new runtime', result.stdout + result.stderr)
            self.assertEqual((app / 'apps/web/.next/BUILD_ID').read_text(), 'old web' if failure else 'new web', result.stdout + result.stderr)
            self.assertEqual((app / '.env.production').read_text(), 'SYNTHETIC_TEST=1\n')
            return result
    def test_success(self):
        result = self.deploy(); self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    def test_recovery(self):
        for failure in ['backup', 'migration', 'build', 'schema', 'health']:
            with self.subTest(failure=failure): self.assertNotEqual(self.deploy(failure).returncode, 0)
if __name__ == '__main__': unittest.main()
