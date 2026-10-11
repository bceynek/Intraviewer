import unittest
from pydantic import ValidationError
from main import LinkedInReview, ProfileSection, profile_review_response


class ReviewTests(unittest.TestCase):
    def section(self, original="", score=None):
        return ProfileSection(original=original, score=score,
                              explanation="Clear", suggestion="A rewrite")

    def review(self, **sections):
        return LinkedInReview(**{name: sections.get(name, self.section()) for name in
            ("headline", "about", "experience", "skills")},
            strengths=["One", "Two", "Three"], improvements=["One", "Two", "Three"])

    def test_applicable_average_includes_zero(self):
        result = profile_review_response(self.review(headline=self.section("Engineer", 0),
            skills=self.section("Python", 9)), "Engineer Python")
        self.assertEqual(result["overall_score"], 45)
        self.assertIsNone(result["about"]["suggestion"])
        self.assertEqual(result["about"]["explanation"], "Not provided")

    def test_unsupported_excerpt_is_removed(self):
        result = profile_review_response(self.review(experience=self.section("Invented job", 10)), "Student")
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["experience"]["score"])
        self.assertIsNone(result["experience"]["suggestion"])

    def test_score_bounds(self):
        for score in (-1, 11):
            with self.assertRaises(ValidationError):
                self.section("Engineer", score)

    def test_missing_content_cannot_retain_score(self):
        section = self.section("  ", 10)
        self.assertIsNone(section.score)
        self.assertIsNone(section.suggestion)
