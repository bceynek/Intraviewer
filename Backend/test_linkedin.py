import unittest
from unittest.mock import patch
import httpx
from linkedin import import_profile, ProfileUnavailable


class LinkedInTests(unittest.TestCase):
    @patch('linkedin.httpx.stream')
    def test_public_metadata(self, stream):
        stream.return_value.__enter__.return_value = httpx.Response(200, text='''
        <script type="application/ld+json">{"@graph":[{"@type":"Person","name":"Sam","description":"Software intern","alumniOf":{"name":"Rutgers"}}]}</script>''')
        result = import_profile('https://linkedin.com/in/sam?tracking=test')
        self.assertIn('Software intern', result['linkedin_text'])
        self.assertIn('Rutgers', result['linkedin_text'])
        self.assertEqual(stream.call_args.args[1], 'https://www.linkedin.com/in/sam/')

    @patch('linkedin.httpx.stream')
    def test_blocked_redirect_and_login(self, stream):
        for code in (302, 403, 429, 999, 200):
            stream.return_value.__enter__.return_value = httpx.Response(code, text='<h1>Sign in</h1>')
            with self.assertRaises(ProfileUnavailable):
                import_profile('https://www.linkedin.com/in/sam')

    @patch('linkedin.httpx.stream')
    def test_unsafe_urls_do_not_fetch(self, stream):
        for url in ('https://localhost/in/sam', 'https://linkedin.com.evil.test/in/sam',
                    'https://www.linkedin.com:8080/in/sam', 'https://www.linkedin.com/login',
                    'https://user:pass@linkedin.com/in/sam'):
            with self.assertRaises(ValueError):
                import_profile(url)
        stream.assert_not_called()
