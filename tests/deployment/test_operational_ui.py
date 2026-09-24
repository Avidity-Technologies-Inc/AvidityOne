"""Exercise success and recovery for the schema-free operational release."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_ticket_email_direct import STUB as ORIGINAL_STUB
ROOT = Path(__file__).resolve().parents[2]
STUB = ORIGINAL_STUB.replace("    output = root / 'app/apps/api/dist'", "    if 'migrate' in args: sys.exit(0)\n    output = root / 'app/apps/api/dist'")
STUB = STUB.replace("elif name in ('sleep', 'npm'): pass", "elif name in ('sleep', 'npm', 'chown'): pass")
class OperationalDeploymentTests(unittest.TestCase):
    def deploy(self, failure='', previous='f0a6ca1a2e62e6007af0f1c3063b1171bd453130'):
        with tempfile.TemporaryDirectory(prefix='avidity-operational-deploy-test-') as directory:
            root = Path(directory); app = root / 'app'; bins = root / 'bin'; bins.mkdir()
            for artifact in ['apps/api/dist', 'apps/web/.next', 'packages/shared/dist', 'packages/config/dist', 'packages/ui/dist', 'node_modules/.prisma/client']:
                folder = app / artifact; folder.mkdir(parents=True); (folder / 'preserved').write_text('old artifact')
            (app / 'apps/api/dist/main.js').write_text('old runtime')
            (app / 'apps/web/.next/BUILD_ID').write_text('old web')
            (app / '.env.production').write_text('SYNTHETIC_TEST=1\n')
            state_file = root / 'state.json'; state_file.write_text(json.dumps({'head': previous, 'avidity-api': True, 'avidity-web': True}))
            for name in ('hostname', 'runuser', 'git', 'systemctl', 'node', 'curl', 'sleep', 'npm', 'pg_dump', 'pg_restore', 'chown'):
                target = bins / name; target.write_text(STUB); target.chmod(0o755)
            script = (ROOT / 'scripts/deploy-operational-ui.sh').read_text().replace('app=/opt/avidity/app', f'app={app}').replace('/opt/avidity/operational-ui-backup.', f'{root}/backup.').replace("[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }", ': # isolated test')
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
    def test_upgrade_from_verified_release(self):
        result = self.deploy(previous='677b069d495f13199627ff23c64f66e19ea3a899')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    def test_recovery(self):
        for failure in ['build', 'health']:
            with self.subTest(failure=failure): self.assertNotEqual(self.deploy(failure).returncode, 0)
if __name__ == '__main__': unittest.main()
