"""Exercise service dependency recovery using isolated command stubs, never systemd."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['DEPLOY_TEST_ROOT'])
state_file = root / 'state.json'
state = json.loads(state_file.read_text())
def save(): state_file.write_text(json.dumps(state))
if name == 'hostname': print('avidityhelpdesk')
elif name == 'runuser':
    sys.exit(subprocess.call(args[args.index('--') + 1:]))
elif name == 'git':
    if args[0] == 'rev-parse': print(str(root / 'app') if '--show-toplevel' in args else state['head'])
    elif args[0] == 'branch': print('main')
    elif args[0] == 'archive': print('synthetic source backup')
    elif args[0] == 'merge': state['head'] = args[-1]; save()
elif name == 'systemctl':
    services = [x for x in args[1:] if not x.startswith('-')]
    if args[0] == 'stop':
        for service in services:
            state[service] = False
            if service == 'avidity-api': state['avidity-web'] = False
        save()
    elif args[0] == 'start':
        for service in services:
            if service == 'avidity-web' and not state['avidity-api']: sys.exit(1)
            state[service] = True
        save()
    elif args[0] == 'is-active': sys.exit(0 if all(state[x] for x in services) else 3)
elif name == 'node':
    sys.stdin.read()
    output = root / 'app/apps/api/dist'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'main.js').write_text('new runtime')
    state['built'] = True; save()
    if os.environ.get('DEPLOY_TEST_FAILURE') == 'build': sys.exit(9)
elif name == 'curl':
    url = next(x for x in args if x.startswith('http'))
    service = 'avidity-api' if ':4000' in url or '/api/health' in url else 'avidity-web'
    if not state[service]: sys.exit(7)
    if state.get('built') and os.environ.get('DEPLOY_TEST_FAILURE') == 'health': sys.exit(22)
elif name in ('sleep', 'npm'): pass
else: raise RuntimeError(name)
'''

class TransportDeploymentTests(unittest.TestCase):
    def run_deployment(self, failure=''):
        with tempfile.TemporaryDirectory(prefix='avidity-deploy-test-') as directory:
            root = Path(directory)
            app = root / 'app'
            dist = app / 'apps/api/dist'
            dist.mkdir(parents=True)
            (dist / 'main.js').write_text('old runtime')
            (app / '.env.production').write_text('SYNTHETIC_TEST=1\n')
            state_file = root / 'state.json'
            state_file.write_text(json.dumps({'head': '518a3b64f5f30924da514df478a455d30e1d1e53',
                                             'avidity-api': True, 'avidity-web': True}))
            bins = root / 'bin'
            bins.mkdir()
            for name in ('hostname', 'runuser', 'git', 'systemctl', 'node', 'curl', 'sleep', 'npm'):
                path = bins / name
                path.write_text(STUB)
                path.chmod(0o755)
            script = (ROOT / 'scripts/deploy-ticket-email-transport.sh').read_text()
            script = script.replace('app=/opt/avidity/app', f'app={app}')
            script = script.replace('/opt/avidity/ticket-email-transport-backup.', f'{root}/backup.')
            script = script.replace("[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }", ': # isolated test, no privileges')
            target = root / 'deploy.sh'
            target.write_text(script)
            env = {**os.environ, 'PATH': f'{bins}:{os.environ["PATH"]}', 'DEPLOY_TEST_ROOT': str(root), 'DEPLOY_TEST_FAILURE': failure}
            result = subprocess.run(['bash', str(target), 'a' * 40], env=env, capture_output=True, text=True, timeout=30)
            return result, json.loads(state_file.read_text()), (dist / 'main.js').read_text()

    def test_success_restarts_both_dependent_services(self):
        result, state, runtime = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(state['avidity-api'] and state['avidity-web'])
        self.assertEqual(runtime, 'new runtime')

    def test_build_failure_restores_runtime_and_both_services(self):
        result, state, runtime = self.run_deployment('build')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(state['avidity-api'] and state['avidity-web'], result.stdout + result.stderr)
        self.assertEqual(runtime, 'old runtime')
        self.assertEqual(state['head'], 'a' * 40)

    def test_health_failure_restores_runtime_and_both_services(self):
        result, state, runtime = self.run_deployment('health')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(state['avidity-api'] and state['avidity-web'], result.stdout + result.stderr)
        self.assertEqual(runtime, 'old runtime')

if __name__ == '__main__':
    unittest.main()
