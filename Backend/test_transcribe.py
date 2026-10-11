import os
import unittest
from io import BytesIO
from unittest.mock import patch

import httpx
from main import app


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def upload(self, content=b'recorded audio', mime='audio/webm'):
        return self.client.post('/api/transcribe', data={
            'audio': (BytesIO(content), 'answer.webm', mime)})

    @patch.dict(os.environ, {'ELEVENLABS_STT_API_KEY': 'test-key', 'ELEVENLABS_API_KEY': 'narration-key'})
    @patch('main.httpx.Client')
    def test_transcription(self, client):
        post = client.return_value.__enter__.return_value.post
        post.return_value = httpx.Response(200, json={'text': 'I built an API.'},
                                          request=httpx.Request('POST', 'https://example.com'))
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'text': 'I built an API.'})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(post.call_args.kwargs['headers']['xi-api-key'], 'test-key')
        self.assertEqual(post.call_args.kwargs['data']['model_id'], 'scribe_v2')
        self.assertEqual(post.call_args.kwargs['files']['file'][1], b'recorded audio')

    @patch('main.httpx.Client')
    def test_invalid_uploads_do_not_call_provider(self, client):
        self.assertEqual(self.client.post('/api/transcribe').status_code, 400)
        self.assertEqual(self.upload(b'').status_code, 400)
        self.assertEqual(self.upload(mime='text/plain').status_code, 400)
        self.assertEqual(self.upload(b'x' * 5_000_001).status_code, 400)
        client.assert_not_called()

    @patch.dict(os.environ, {'ELEVENLABS_STT_API_KEY': '', 'ELEVENLABS_API_KEY': 'narration-key'})
    def test_missing_key(self):
        self.assertEqual(self.upload().status_code, 503)

    @patch.dict(os.environ, {'ELEVENLABS_STT_API_KEY': 'test-key', 'ELEVENLABS_API_KEY': 'narration-key'})
    @patch('main.httpx.Client')
    def test_provider_failure_and_timeout(self, client):
        post = client.return_value.__enter__.return_value.post
        post.return_value = httpx.Response(401, text='secret upstream details',
                                          request=httpx.Request('POST', 'https://example.com'))
        response = self.upload()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('secret', response.get_data(as_text=True))
        post.side_effect = httpx.ReadTimeout('timeout')
        self.assertEqual(self.upload().status_code, 504)
