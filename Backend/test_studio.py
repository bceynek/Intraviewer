"""Studio endpoints: validate input and preserve actual candidate context."""
import unittest
from unittest.mock import patch
from main import app, Feedback, Followup


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    @patch('main.generate')
    def test_document_review_is_grounded_in_source(self, generate):
        generate.return_value = Feedback(feedback='Original: Built a tool. Suggested: Built an internal tool.')
        response = self.client.post('/api/resume-review', json={'resume_text': 'Built an internal tool.', 'role': 'Engineer'})
        self.assertEqual(response.status_code, 200)
        prompt = generate.call_args.args[0]
        self.assertIn('Built an internal tool.', prompt)
        self.assertIn('Never invent', prompt)

    @patch('main.generate')
    def test_pitch_is_text_only(self, generate):
        generate.return_value = Feedback(feedback='Clarify who uses your work.')
        response = self.client.post('/api/pitch-review', json={'pitch': 'I build tools.', 'scenario': 'Career fair', 'duration': 60})
        self.assertEqual(response.status_code, 200)
        self.assertIn('do not claim measured pacing', generate.call_args.args[0])

    @patch('main.generate')
    def test_followup_receives_entire_conversation(self, generate):
        generate.return_value = Followup(question='What changed because of your decision?')
        history = [{'question': 'Describe leadership.', 'answer': 'I led a migration.'},
                   {'question': 'What was your role?', 'answer': 'I chose a phased rollout.'}]
        response = self.client.post('/api/interview-followup', json={
            'role': 'Engineer', 'experience': 'senior', 'style': 'pressure', 'history': history})
        self.assertEqual(response.status_code, 200)
        self.assertIn('I led a migration.', generate.call_args.args[0])
        self.assertIn('I chose a phased rollout.', generate.call_args.args[0])
        self.assertEqual(response.json['question'], generate.return_value.question)

    @patch('main.generate')
    def test_invalid_inputs_do_not_reach_model(self, generate):
        cases = [('/api/resume-review', {'resume_text': ' '}),
                 ('/api/resume-review', {'resume_text': 'x' * 20001}),
                 ('/api/pitch-review', {'pitch': 'Hello', 'scenario': 'Fair', 'duration': True}),
                 ('/api/pitch-review', {'pitch': 'Hello', 'scenario': 'Fair', 'duration': 120}),
                 ('/api/interview-followup', {'role': 'Dev', 'experience': 'entry', 'history': []}),
                 ('/api/interview-followup', {'role': 'Dev', 'experience': 'entry', 'history': [None]}),
                 ('/api/questions', {'role': 'Dev', 'experience': 'entry', 'style': 'abusive'})]
        for path, payload in cases:
            with self.subTest(path=path, payload=payload):
                self.assertEqual(self.client.post(path, json=payload).status_code, 400)
        generate.assert_not_called()

    @patch('main.generate')
    def test_final_review_preserves_long_followup_answers(self, generate):
        generate.return_value = Feedback(feedback='Be specific.')
        answer = 'x' * 30000 + ' final evidence'
        response = self.client.post('/api/feedback', json={'role': 'Dev', 'experience': 'entry',
            'answers': [{'question': 'Why?', 'answer': answer}] * 5})
        self.assertEqual(response.status_code, 200)
        self.assertIn('final evidence', generate.call_args.args[0])
