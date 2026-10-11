import unittest
from unittest.mock import patch

import httpx
from google.genai import errors
from main import app, Questions, Feedback, AnswerFeedback


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
        generate.return_value = AnswerFeedback(
            strongest_point='Names a concrete project.', biggest_improvement='Describe your contribution.',
            quoted_example='I built a website.', suggested_rewrite='My project was building a website.')
        response = self.client.post('/api/answer-feedback', json={
            **self.context, 'question': 'Tell me about a project.', 'answer': 'I built a website.'
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, generate.return_value.model_dump())
        self.assertIs(generate.call_args.args[1], AnswerFeedback)

    @patch('main.generate')
    def test_guided_feedback_rejects_invented_quote(self, generate):
        generate.return_value = AnswerFeedback(
            strongest_point='A project.', biggest_improvement='Add evidence.',
            quoted_example='I increased revenue.', suggested_rewrite='I built a website.')
        response = self.client.post('/api/answer-feedback', json={
            **self.context, 'question': 'Your project?', 'answer': 'I built a website.'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('quoted_example', response.json)

    def test_guided_feedback_rejects_blank_sections(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            AnswerFeedback(strongest_point=' ', biggest_improvement='Add evidence.',
                           quoted_example='My answer', suggested_rewrite='My revised answer')

    @patch('main.generate')
    def test_guided_feedback_requires_answer(self, generate):
        response = self.client.post('/api/answer-feedback', json={
            **self.context, 'question': 'Tell me about a project.', 'answer': ' '
        })
        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch('main.generate')
    def test_background_reaches_all_coaching_endpoints(self, generate):
        background = {**self.context, 'resume_text': 'Studied biology'}
        generate.return_value = Questions(questions=['A question?'] * 5)
        self.assertEqual(self.client.post('/api/questions', json=background).status_code, 200)
        self.assertIn('Studied biology', generate.call_args.args[0])
        generate.return_value = Feedback(feedback='Helpful feedback')
        entry = {'question': 'A question?', 'answer': 'An answer'}
        for path, extra in [('/api/answer-feedback', entry), ('/api/feedback', {'answers': [entry] * 5})]:
            generate.return_value = (AnswerFeedback(strongest_point='Clear.', biggest_improvement='Add evidence.',
                quoted_example='An answer', suggested_rewrite='An answer')
                if path == '/api/answer-feedback' else Feedback(feedback='Helpful feedback'))
            self.assertEqual(self.client.post(path, json={**background, **extra}).status_code, 200)
            self.assertIn('Studied biology', generate.call_args.args[0])

    @patch('main.generate')
    def test_invalid_background_is_rejected(self, generate):
        for extra in [{'resume_text': 'x' * 20001}, {'resume_text': []}]:
            self.assertEqual(self.client.post('/api/questions', json={**self.context, **extra}).status_code, 400)
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
