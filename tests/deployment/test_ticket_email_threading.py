"""Reuse the isolated API deployment/recovery harness for the threading release."""
import unittest
import test_ticket_email_transport as harness

class ThreadingDeploymentTests(harness.TransportDeploymentTests):
    script_name = 'deploy-ticket-email-threading.sh'
    backup_prefix = 'ticket-email-threading-backup'

    def run_deployment(self, failure='', previous=None):
        return super().run_deployment(failure, previous or '367354e16b6d47ce118fb6ee4bd715399794cca4')

    test_attachment_update_from_verified_recovery_release = None

    def test_rejects_unreviewed_revision_before_stopping_services(self):
        result, state, runtime = self.run_deployment(previous='cbf7f7eb31489ee578f721a42a2c36679bf59ea7')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(state['avidity-api'] and state['avidity-web'])
        self.assertEqual(runtime, 'old runtime')

if __name__ == '__main__':
    unittest.main()
