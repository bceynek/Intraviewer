import unittest
from unittest.mock import patch

import httpx
from google.genai import errors
from main import app, Questions, Feedback


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.context = {"role": "Developer", "experience": "entry"}

    def test_static_and_secret_is_not_served(self):
        with self.client.get('/') as response:
            self.assertEqual(response.status_code, 200)
        with self.client.get('/script.js') as response:
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/dotenv.env').status_code, 404)

    @patch('main.generate')
    def test_questions_and_feedback(self, generate):
        generate.return_value = Questions(questions=[f'Question {i}?' for i in range(5)])
        response = self.client.post('/api/questions', json=self.context)
        self.assertEqual(response.status_code, 200)
        questions = response.json['questions']
        self.assertEqual(len(questions), 5)
        generate.return_value = Feedback(feedback='Use a specific example.')
        response = self.client.post('/api/feedback', json={
            **self.context, 'answers': [{'question': q, 'answer': 'My example'} for q in questions]
        })
        self.assertEqual(response.json['feedback'], 'Use a specific example.')

    @patch('main.generate')
    def test_guided_feedback(self, generate):
        generate.return_value = Feedback(feedback='Describe your contribution.')
        response = self.client.post('/api/answer-feedback', json={
            **self.context, 'question': 'Tell me about a project.', 'answer': 'I built a website.'
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['feedback'], 'Describe your contribution.')

    @patch('main.generate')
    def test_guided_feedback_requires_answer(self, generate):
        response = self.client.post('/api/answer-feedback', json={
            **self.context, 'question': 'Tell me about a project.', 'answer': ' '
        })
        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch('main.generate')
    def test_background_reaches_all_coaching_endpoints(self, generate):
        background = {**self.context, 'linkedin_url': 'https://www.linkedin.com/in/example',
                      'linkedin_text': 'Built community projects', 'resume_text': 'Studied biology'}
        generate.return_value = Questions(questions=['A question?'] * 5)
        self.assertEqual(self.client.post('/api/questions', json=background).status_code, 200)
        self.assertIn('Studied biology', generate.call_args.args[0])
        generate.return_value = Feedback(feedback='Helpful feedback')
        entry = {'question': 'A question?', 'answer': 'An answer'}
        for path, extra in [('/api/answer-feedback', entry), ('/api/feedback', {'answers': [entry] * 5})]:
            self.assertEqual(self.client.post(path, json={**background, **extra}).status_code, 200)
            self.assertIn('Built community projects', generate.call_args.args[0])

    @patch('main.generate')
    def test_invalid_background_is_rejected(self, generate):
        for extra in [{'linkedin_url': 'https://linkedin.com.evil.example/in/a'},
                      {'resume_text': 'x' * 20001}, {'linkedin_text': []}]:
            self.assertEqual(self.client.post('/api/questions', json={**self.context, **extra}).status_code, 400)
        generate.assert_not_called()

    @patch('main.generate')
    def test_linkedin_review_without_interview_setup(self, generate):
        generate.return_value = Feedback(feedback='Clarify your headline.')
        response = self.client.post('/api/linkedin-review', json={'linkedin_text': 'Student building web apps'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['feedback'], 'Clarify your headline.')
        self.assertIn('Student building web apps', generate.call_args.args[0])

    @patch('main.generate')
    def test_linkedin_review_requires_profile_text(self, generate):
        self.assertEqual(self.client.post('/api/linkedin-review', json={'linkedin_text': ' '}).status_code, 400)
        generate.assert_not_called()

    @patch('main.generate')
    def test_bad_input_does_not_call_gemini(self, generate):
        for payload in [None, [], {}, {'role': 'x', 'experience': 4}]:
            self.assertEqual(self.client.post('/api/questions', json=payload).status_code, 400)
        self.assertEqual(self.client.post('/api/feedback', json={**self.context, 'answers': []}).status_code, 400)
        generate.assert_not_called()

    @patch('main.generate', side_effect=httpx.ReadTimeout('secret request details'))
    def test_timeout_is_safe_and_retryable(self, generate):
        response = self.client.post('/api/questions', json=self.context)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('secret', response.json['error'])

    @patch('main.generate', side_effect=errors.ClientError(429, {'error': {'message': 'secret'}}))
    def test_quota_error(self, generate):
        response = self.client.post('/api/questions', json=self.context)
        self.assertEqual(response.status_code, 502)
        self.assertIn('quota', response.json['error'])
        self.assertNotIn('secret', response.json['error'])

    @patch('main.generate', side_effect=errors.ServerError(503, {'error': {'message': 'secret'}}))
    def test_service_unavailable_error(self, generate):
        response = self.client.post('/api/questions', json=self.context)
        self.assertEqual(response.status_code, 502)
        self.assertIn('503', response.json['error'])
        self.assertNotIn('secret', response.json['error'])


if __name__ == '__main__':
    unittest.main()
