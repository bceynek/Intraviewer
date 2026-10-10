"""Coaching contracts: content grounding, full history, and safe validation."""
import json
import unittest
from unittest.mock import patch

from main import app, DocumentReview, Suggestion, PitchReview, InterviewTurn, Feedback, Questions


class CoachingTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.background = {"role": "Designer", "experience": "entry",
                           "resume_text": "Built a community website.", "style": "pressure"}
        self.history = [{"question": "How did you lead?", "answer": "I improved teamwork."},
                        {"question": "What did you do specifically?", "answer": "I ran weekly planning."}]

    def review(self, original="Built a community website."):
        return DocumentReview(summary="Make your contribution clear.",
                              strengths=["A concrete project is supplied."],
                              suggestions=[Suggestion(section="Experience", original=original,
                                  suggested="Developed a website for a community project.",
                                  rationale="Uses a direct action verb.",
                                  evidence_needed="What changed for the community?")],
                              improved_text="Developed a website for a community project.")

    @patch("main.generate")
    def test_document_review_preserves_source_and_target(self, generate):
        generate.return_value = self.review()
        response = self.client.post("/api/profile-review", json={"kind": "resume",
            "text": "Built a community website.", "role": "Designer"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["suggestions"][0]["original"], "Built a community website.")
        prompt = generate.call_args.args[0]
        self.assertIn('"target_role": "Designer"', prompt)
        self.assertIn("Never invent", prompt)
        self.assertIn("ATS", prompt)

    @patch("main.generate")
    def test_linkedin_review_uses_pasted_text(self, generate):
        generate.return_value = self.review()
        response = self.client.post("/api/profile-review", json={"kind": "linkedin",
            "text": "Built a community website."})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Missing means absent from this text", generate.call_args.args[0])

    @patch("main.generate")
    def test_untraceable_comparison_is_rejected(self, generate):
        generate.return_value = self.review("Invented source excerpt")
        response = self.client.post("/api/profile-review", json={"kind": "resume",
            "text": "Built a community website."})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("suggestions", response.json)

    @patch("main.generate")
    def test_invalid_document_never_calls_ai(self, generate):
        for payload in [{"kind": "other", "text": "Text"}, {"kind": "resume", "text": " "},
                        {"kind": "linkedin", "text": "x" * 15001}, {"kind": "resume", "text": []}]:
            self.assertEqual(self.client.post("/api/profile-review", json=payload).status_code, 400)
        generate.assert_not_called()

    @patch("main.generate")
    def test_pitch_transcription_does_not_claim_audio_analysis(self, generate):
        generate.return_value = PitchReview(feedback="Lead with your work.",
            refined_pitch="I build community websites.", follow_up_question="Who used your website?")
        response = self.client.post("/api/pitch-review", json={"pitch": "I build websites.",
            "scenario": "Meeting a recruiter", "duration": 30, "input_mode": "speech_transcript"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("do NOT evaluate vocal confidence", generate.call_args.args[0])
        self.assertIn('"target_seconds": 30', generate.call_args.args[0])

    @patch("main.generate")
    def test_pitch_followup_is_grounded_in_original_pitch(self, generate):
        generate.return_value = Feedback(feedback="Explain how you solved the problem.")
        response = self.client.post("/api/pitch-followup", json={
            "pitch": "I build community websites.", "question": "What was one challenge?",
            "answer": "Users struggled to find the volunteer page."})
        self.assertEqual(response.status_code, 200)
        self.assertIn("community websites", generate.call_args.args[0])
        self.assertIn("volunteer page", generate.call_args.args[0])

    @patch("main.generate")
    def test_pitch_followup_rejects_empty_response(self, generate):
        response = self.client.post("/api/pitch-followup", json={
            "pitch": "I build websites.", "question": "What was difficult?", "answer": " "})
        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch("main.generate")
    def test_invalid_pitch_never_calls_ai(self, generate):
        base = {"pitch": "I build websites.", "scenario": "Networking"}
        for extra in [{"pitch": " "}, {"duration": True}, {"duration": 42}, {"input_mode": "audio"}]:
            self.assertEqual(self.client.post("/api/pitch-review", json={**base, **extra}).status_code, 400)
        generate.assert_not_called()

    @patch("main.generate")
    def test_follow_up_receives_complete_context(self, generate):
        generate.return_value = InterviewTurn(follow_up=True, question="What changed after planning?", guidance="")
        response = self.client.post("/api/interview-turn", json={**self.background,
            "history": self.history, "follow_up_count": 1})
        self.assertEqual(response.status_code, 200)
        prompt = generate.call_args.args[0]
        self.assertIn("I improved teamwork.", prompt)
        self.assertIn("I ran weekly planning.", prompt)
        self.assertIn("Built a community website.", prompt)
        self.assertIn("never hostility", prompt)

    @patch("main.generate")
    def test_follow_up_limit_is_enforced(self, generate):
        generate.return_value = InterviewTurn(follow_up=True, question="Another question?", guidance="Coaching")
        response = self.client.post("/api/interview-turn", json={**self.background,
            "history": self.history, "follow_up_count": 2})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["follow_up"])
        self.assertEqual(response.json["question"], "")
        self.assertEqual(response.json["guidance"], "")

    @patch("main.generate")
    def test_guided_feedback_is_retained(self, generate):
        generate.return_value = InterviewTurn(follow_up=False, question="", guidance="Describe the outcome.")
        response = self.client.post("/api/interview-turn", json={**self.background,
            "history": self.history, "mode": "guided"})
        self.assertEqual(response.json["guidance"], "Describe the outcome.")

    @patch("main.generate")
    def test_empty_follow_up_is_retryable(self, generate):
        generate.return_value = InterviewTurn(follow_up=True, question=" ", guidance="")
        response = self.client.post("/api/interview-turn", json={**self.background, "history": self.history})
        self.assertEqual(response.status_code, 503)

    @patch("main.generate")
    def test_invalid_conversation_never_calls_ai(self, generate):
        for extra in [{"history": []}, {"history": self.history * 8}, {"history": ["bad"]},
                      {"history": [{"question": "q", "answer": " "}]}, {"follow_up_count": True},
                      {"follow_up_count": 3}, {"style": "hostile"}, {"mode": "invalid"}]:
            response = self.client.post("/api/interview-turn", json={**self.background,
                "history": self.history, **extra})
            self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch("main.generate")
    def test_early_review_includes_follow_up(self, generate):
        generate.return_value = Feedback(feedback="Support your claims with outcomes.")
        response = self.client.post("/api/interview-review", json={**self.background, "history": self.history})
        self.assertEqual(response.status_code, 200)
        self.assertIn("I ran weekly planning.", generate.call_args.args[0])
        self.assertIn("may have ended early", generate.call_args.args[0])

    @patch("main.generate")
    def test_question_style_reaches_model(self, generate):
        generate.return_value = Questions(questions=["What did you do?"] * 5)
        self.assertEqual(self.client.post("/api/questions", json=self.background).status_code, 200)
        self.assertIn('"style": "pressure"', generate.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
