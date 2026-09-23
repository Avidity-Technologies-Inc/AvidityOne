"""Parse the production MIME encoder using Python's independent standard parser.
Run after npm run build:api. No network, credentials or real mail are used.
"""
import base64
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ThreadedMimeTests(unittest.TestCase):
    def test_headers_bodies_and_files_round_trip(self):
        result = json.loads(subprocess.check_output(['node', '-e', r'''
const {buildReplyMime}=require('./apps/api/dist/modules/mailboxes/providers/mail-threading');
const name='Diseño final 😀 '.repeat(20)+'.pdf';
const subject='Re: [SUP-12345] Diseño 😀 '.repeat(8);
const input={mailboxId:'box',mailboxEmailAddress:'support@example.test',to:['client@example.test'],cc:['cc@example.test'],replyToAddress:'support@example.test',subject,bodyText:'Thanks\nGracias',bodyHtml:'<table><tr><td>Firma</td></tr></table><img src="cid:logo">',inReplyTo:'<parent@example.test>',references:'<ancestor@example.test>',attachments:[{originalFilename:name,mimeType:'application/pdf',contentBytes:Buffer.from([0,255,10,13]),sizeBytes:4},{originalFilename:'logo.png',mimeType:'image/png',contentBytes:Buffer.from('synthetic image'),sizeBytes:15,isInline:true,contentId:'logo'}]};
console.log(JSON.stringify({name,subject,html:input.bodyHtml,mime:Buffer.from(buildReplyMime(input,'<outbound@example.test>','synthetic')).toString('base64')}));
'''], cwd=ROOT, text=True))
        message = BytesParser(policy=policy.default).parsebytes(base64.b64decode(result['mime']))
        self.assertEqual(str(message['Subject']), result['subject'])
        self.assertEqual(message['Message-ID'], '<outbound@example.test>')
        self.assertEqual(message['In-Reply-To'], '<parent@example.test>')
        self.assertEqual(str(message['To']), 'client@example.test')
        self.assertEqual(message.get_body(preferencelist=('html',)).get_content(), result['html'])
        self.assertEqual(message.get_body(preferencelist=('plain',)).get_content(), 'Thanks\nGracias')
        parts = list(message.walk())
        pdf = next(p for p in parts if p.get_content_type() == 'application/pdf')
        self.assertEqual(pdf.get_filename(), result['name'])
        self.assertEqual(pdf.get_payload(decode=True), bytes([0,255,10,13]))
        image = next(p for p in parts if p.get_content_type() == 'image/png')
        self.assertEqual(image['Content-ID'], '<logo>')
        self.assertEqual(image.get_content_disposition(), 'inline')
        self.assertEqual(image.get_payload(decode=True), b'synthetic image')
        self.assertFalse(any(p.defects for p in parts))

if __name__ == '__main__':
    unittest.main()
