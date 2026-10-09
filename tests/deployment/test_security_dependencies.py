"""Verify dependency deployment and full rollback using isolated command stubs."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = '489792fff703ed916dc90c27b1542a01955c9857'
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, shutil, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['DEPLOY_TEST_ROOT'])
app = root / 'app'
state_file = root / 'state.json'
state = json.loads(state_file.read_text())
failure = os.environ.get('DEPLOY_TEST_FAILURE', '')
def save(): state_file.write_text(json.dumps(state))
def write(location, text):
    p = app / location; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
if name == 'hostname': print('avidityhelpdesk')
elif name == 'runuser': sys.exit(subprocess.call(args[args.index('--') + 1:]))
elif name == 'chown': pass
elif name == 'git':
    if args[0] == 'rev-parse': print(str(app) if '--show-toplevel' in args else state['head'])
    elif args[0] == 'branch': print('main')
    elif args[0] == 'remote': print('git@github.com:Avidity-Technologies-Inc/AvidityOne.git')
    elif args[0] == 'archive': print('synthetic source backup')
    elif args[0] == 'diff' and failure == 'schema': print('prisma/schema.prisma')
    elif args[0] == 'merge': state['head'] = args[-1]; save()
elif name == 'systemctl':
    services = [x for x in args[1:] if not x.startswith('-')]
    if args[0] == 'stop':
        state['stopped'] = True
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
    if '-e' in args: sys.exit(1 if failure == 'engine' else 0)
    sys.stdin.read()
    step = args[1:]
    if 'migrate' in step:
        if 'deploy' in step: raise RuntimeError('Production migration is forbidden')
        sys.exit(1 if failure == 'pending-migration' else 0)
    if 'ci' in step:
        state['installed'] = True; save()
        for location in ('node_modules', 'apps/api/node_modules', 'apps/web/node_modules'):
            p = app / location
            if p.exists(): shutil.rmtree(p)
        write('node_modules/version', 'new dependencies')
        write('apps/api/node_modules/version', 'new nested dependencies')
        write('apps/web/node_modules/version', 'newly introduced nested dependencies')
        if failure == 'install': sys.exit(9)
    elif 'scripts/check-security-dependencies.cjs' in step:
        if failure == 'gate': sys.exit(9)
    elif 'prisma:generate' in step:
        write('node_modules/.prisma/client/version', 'new prisma')
    elif 'build' in step:
        write('apps/api/dist/main.js', 'new runtime')
        write('apps/web/.next/BUILD_ID', 'new web')
        state['built'] = True; save()
        if failure == 'build': sys.exit(9)
elif name == 'curl':
    url = next(x for x in args if x.startswith('http'))
    service = 'avidity-api' if ':4000' in url or '/api/health' in url else 'avidity-web'
    if not state[service]: sys.exit(7)
    if state.get('built') and failure == 'health': sys.exit(22)
elif name in ('sleep', 'npm'): pass
else: raise RuntimeError(name)
'''


class SecurityDependencyDeploymentTests(unittest.TestCase):
    def run_deployment(self, failure=''):
        with tempfile.TemporaryDirectory(prefix='avidity-security-deploy-test-') as directory:
            root = Path(directory)
            app = root / 'app'
            original = {
                'apps/api/dist/main.js': 'old runtime',
                'apps/web/.next/BUILD_ID': 'old web',
                'packages/shared/dist/index.js': 'old shared',
                'packages/config/dist/index.js': 'old config',
                'packages/ui/dist/index.js': 'old ui',
                'node_modules/version': 'old dependencies',
                'node_modules/.prisma/client/version': 'old prisma',
                'apps/api/node_modules/version': 'old nested dependencies',
                '.env.production': 'SYNTHETIC_TEST=1\n',
            }
            for location, text in original.items():
                path = app / location
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            state_file = root / 'state.json'
            state_file.write_text(json.dumps({'head': BASE, 'avidity-api': True, 'avidity-web': True}))
            bins = root / 'bin'
            bins.mkdir()
            for name in ('hostname', 'runuser', 'chown', 'git', 'systemctl', 'node', 'curl', 'sleep', 'npm'):
                path = bins / name
                path.write_text(STUB)
                path.chmod(0o755)
            script = (ROOT / 'scripts/deploy-security-dependencies.sh').read_text()
            script = script.replace('app=/opt/avidity/app', f'app={app}')
            script = script.replace('/opt/avidity/security-dependencies-backup.', f'{root}/backup.')
            script = script.replace("[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).'; exit 1; }", ': # isolated test, no privileges')
            target = root / 'deploy.sh'
            target.write_text(script)
            env = {**os.environ, 'PATH': f'{bins}:{os.environ["PATH"]}', 'DEPLOY_TEST_ROOT': str(root), 'DEPLOY_TEST_FAILURE': failure}
            result = subprocess.run(['bash', str(target), 'a' * 40], env=env, capture_output=True, text=True, timeout=30)
            evidence = result.stdout + result.stderr
            state = json.loads(state_file.read_text())
            self.assertTrue(state['avidity-api'] and state['avidity-web'], evidence)
            self.assertEqual((app / '.env.production').read_text(), original['.env.production'], evidence)
            if failure:
                self.assertNotEqual(result.returncode, 0, evidence)
                for location, text in original.items():
                    self.assertEqual((app / location).read_text(), text, evidence)
                self.assertFalse((app / 'apps/web/node_modules').exists(), evidence)
            else:
                self.assertEqual(result.returncode, 0, evidence)
                self.assertEqual((app / 'node_modules/version').read_text(), 'new dependencies', evidence)
                self.assertEqual((app / 'apps/api/dist/main.js').read_text(), 'new runtime', evidence)
            return state

    def test_success(self):
        self.assertEqual(self.run_deployment()['head'], 'a' * 40)

    def test_preflight_leaves_services_and_checkout_untouched(self):
        for failure in ('engine', 'schema', 'pending-migration'):
            with self.subTest(failure=failure):
                state = self.run_deployment(failure)
                self.assertFalse(state.get('stopped'))
                self.assertFalse(state.get('installed'))
                self.assertEqual(state['head'], BASE)

    def test_failed_update_restores_all_runtime_dependencies(self):
        for failure in ('install', 'gate', 'build', 'health'):
            with self.subTest(failure=failure):
                self.assertEqual(self.run_deployment(failure)['head'], 'a' * 40)


if __name__ == '__main__':
    unittest.main()
