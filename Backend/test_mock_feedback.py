import unittest
from unittest.mock import patch
from main import app, Feedback


class MockFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.turn = {'question': 'What did you change?', 'answer': 'I added integration tests.'}
        self.context = {'role': 'Developer', 'experience': 'entry'}

    @patch('main.generate', return_value=Feedback(feedback='Explain which regressions the tests caught.'))
    def test_early_end_and_full_followup_history(self, generate):
        for count in (1, 5, 15):
            response = self.client.post('/api/feedback', json={
                **self.context, 'mode': 'mock', 'answers': [self.turn] * count})
            self.assertEqual(response.status_code, 200)
            self.assertIn('recorded interview turns', generate.call_args.args[0])
            self.assertIn('Do not invent speech metrics', generate.call_args.args[0])

    @patch('main.generate')
    def test_empty_or_excessive_mock_history_is_rejected(self, generate):
        for count in (0, 16):
            response = self.client.post('/api/feedback', json={
                **self.context, 'mode': 'mock', 'answers': [self.turn] * count})
            self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch('main.generate', return_value=Feedback(feedback='Feedback'))
    def test_guided_contract_and_prompt_remain_unchanged(self, generate):
        for count in (1, 15):
            response = self.client.post('/api/feedback', json={
                **self.context, 'answers': [self.turn] * count})
            self.assertEqual(response.status_code, 400)
        generate.assert_not_called()
        response = self.client.post('/api/feedback', json={
            **self.context, 'answers': [self.turn] * 5})
        self.assertEqual(response.status_code, 200)
        prompt = generate.call_args.args[0]
        self.assertIn('Give specific feedback on each of the five answers', prompt)
        self.assertNotIn('recorded interview turns', prompt)
