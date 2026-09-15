"""Public regression tests for claims made by the CoAutoResearch system paper.

The tests are deliberately narrow and synthetic. They establish software
contracts, not scientific effectiveness.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import unittest

from support import (
    CARD,
    EXCLUDED,
    FINDINGS,
    LINE1,
    LINE2,
    PRIOR,
    case,
    deferred_cards,
    defer_request,
    evaluate,
    findings,
    line,
)
from runtime_smoke import run as runtime_smoke

REPO = Path(__file__).resolve().parents[2]


class EvidenceAdmissionContracts(unittest.TestCase):
    def assert_rejected(self, bundle, fragment: str):
        result = evaluate(bundle)
        self.assertFalse(result["publishable"], result)
        self.assertIn(fragment, "; ".join(result["errors"]))

    def test_exclusion_only_card_cannot_become_line_support(self):
        before = {FINDINGS: findings(accepted=[PRIOR]), LINE1: line(support=[PRIOR])}
        before[LINE1]["material_exclusions"] = [
            {"id": EXCLUDED, "reason": "Synthetic excluded history; never accepted."}
        ]
        after = deepcopy(before)
        after[FINDINGS]["canonical_revision"] = 1
        after[LINE1]["supporting_cards"].append(EXCLUDED)
        self.assert_rejected(
            case(before, after, requests=defer_request(), cards=deferred_cards()),
            "unknown/unaccepted",
        )

    def test_exclusion_only_card_cannot_become_accepted_finding(self):
        before = {FINDINGS: findings(accepted=[PRIOR]), LINE1: line(support=[PRIOR])}
        before[LINE1]["material_exclusions"] = [
            {"id": EXCLUDED, "reason": "Synthetic excluded history; never accepted."}
        ]
        after = deepcopy(before)
        after[FINDINGS]["canonical_revision"] = 1
        after[FINDINGS]["accepted_card_ids"].append(EXCLUDED)
        self.assert_rejected(
            case(before, after, requests=defer_request(), cards=deferred_cards()),
            "promote cards without an accepted current decision",
        )

    def test_superseded_history_cannot_return_as_active_support(self):
        before = {
            FINDINGS: findings(accepted=[PRIOR], superseded=[EXCLUDED]),
            LINE1: line(support=[PRIOR]),
        }
        after = deepcopy(before)
        after[FINDINGS]["canonical_revision"] = 1
        after[LINE1]["supporting_cards"].append(EXCLUDED)
        self.assert_rejected(
            case(before, after, requests=defer_request(), cards=deferred_cards()),
            "unknown/unaccepted",
        )

    def test_old_accepted_card_can_support_multiple_research_lines(self):
        before = {FINDINGS: findings(accepted=[PRIOR]), LINE1: line(support=[PRIOR])}
        after = deepcopy(before)
        after[FINDINGS]["canonical_revision"] = 1
        after[LINE2] = line("L0002", "candidate", support=[PRIOR])
        result = evaluate(case(before, after, requests=defer_request(), cards=deferred_cards()))
        self.assertTrue(result["publishable"], result["errors"])
        self.assertIn(PRIOR, result["effective_projection"][LINE1]["supporting_cards"])
        self.assertIn(PRIOR, result["effective_projection"][LINE2]["supporting_cards"])


class RuntimeContracts(unittest.TestCase):
    def test_plan_must_target_current_critical_path_item(self):
        result = runtime_smoke(REPO, invalid_cp=True)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["approval_status"], "plan_rejected")

    def test_publication_receipt_and_revision_are_bound(self):
        result = runtime_smoke(REPO, invalid_cp=False)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["completion_status"], "published")
        self.assertEqual(result["published_revision"], 1)
        self.assertIn(CARD, result["qualified_card_ids"])


if __name__ == "__main__":
    unittest.main()
