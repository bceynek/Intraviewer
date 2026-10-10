import unittest
from io import BytesIO
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from main import app


def pdf_bytes(text=None, encrypted=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    if text:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 50 700 Td ({text}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        writer.encrypt('password')
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class ResumeTests(unittest.TestCase):
    def upload(self, content, name='resume.pdf'):
        return app.test_client().post('/api/resume', data={'resume': (BytesIO(content), name)})

    def test_extract_real_pdf(self):
        response = self.upload(pdf_bytes('Software intern at Rutgers'))
        self.assertEqual(response.status_code, 200)
        self.assertIn('Software intern at Rutgers', response.json['resume_text'])

    def test_invalid_and_missing(self):
        self.assertEqual(self.upload(b'not a pdf').status_code, 400)
        self.assertEqual(self.upload(b'text', 'resume.txt').status_code, 400)
        self.assertEqual(app.test_client().post('/api/resume').status_code, 400)

    def test_blank_encrypted_and_oversized(self):
        self.assertEqual(self.upload(pdf_bytes()).status_code, 422)
        self.assertEqual(self.upload(pdf_bytes(encrypted=True)).status_code, 400)
        self.assertEqual(self.upload(b'%PDF-' + b' ' * 5_000_000).status_code, 413)
