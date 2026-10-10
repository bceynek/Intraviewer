import os
import unittest
from unittest.mock import patch
import httpx
from main import app


class NarrationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    @patch.dict(os.environ, {'ELEVENLABS_API_KEY': ''})
    def test_missing_key(self):
        self.assertEqual(self.client.post('/api/narrate', json={'text': 'Feedback'}).status_code, 503)

    @patch('main.httpx.Client')
    def test_invalid_input_never_calls_provider(self, client):
        for data in [{}, {'text': ''}, {'text': 'x' * 10001}, {'text': []}]:
            self.assertEqual(self.client.post('/api/narrate', json=data).status_code, 400)
        client.assert_not_called()

    @patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'private-key', 'ELEVENLABS_VOICE_ID': 'jawhny-id'})
    @patch('main.httpx.Client')
    def test_audio_and_private_cache(self, client):
        provider = client.return_value.__enter__.return_value
        provider.post.return_value = httpx.Response(200, content=b'mp3-audio', request=httpx.Request('POST', 'https://api.elevenlabs.io'))
        response = self.client.post('/api/narrate', json={'text': 'Good example.'})
        self.assertEqual(response.data, b'mp3-audio')
        self.assertEqual(response.mimetype, 'audio/mpeg')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(provider.post.call_args.kwargs['json']['text'], 'Good example.')
        provider.get.assert_not_called()

    @patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'private-key', 'ELEVENLABS_VOICE_ID': ''})
    @patch('main.httpx.Client')
    def test_missing_or_ambiguous_jawhny_does_not_synthesize(self, client):
        provider = client.return_value.__enter__.return_value
        for voices in [[], [{'name': 'Jawhny - Warm', 'voice_id': 'a'}, {'name': 'Jawhny - Other', 'voice_id': 'b'}]]:
            provider.get.return_value = httpx.Response(200, json={'voices': voices}, request=httpx.Request('GET', 'https://api.elevenlabs.io'))
            response = self.client.post('/api/narrate', json={'text': 'Feedback'})
            self.assertEqual(response.status_code, 503)
        provider.post.assert_not_called()

    @patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'private-key', 'ELEVENLABS_VOICE_ID': 'jawhny'})
    @patch('main.httpx.Client')
    def test_provider_failures_hide_sensitive_details(self, client):
        provider = client.return_value.__enter__.return_value
        for status in [401, 403, 404, 429, 500]:
            provider.post.return_value = httpx.Response(status, text='private-key', request=httpx.Request('POST', 'https://api.elevenlabs.io'))
            response = self.client.post('/api/narrate', json={'text': 'Feedback'})
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private-key', response.json['error'])
        provider.post.side_effect = httpx.ReadTimeout('private-key')
        self.assertEqual(self.client.post('/api/narrate', json={'text': 'Feedback'}).status_code, 504)
