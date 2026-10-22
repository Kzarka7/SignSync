"""Synthetic checks for rejection-rule selection; no model artifacts needed."""
import unittest
import numpy as np
from run_p4_idle_rejection_experiment import BASE_RULE, decisions, select_rule

class AcceptanceRulesTests(unittest.TestCase):
    labels = np.array(['HELLO', 'REST', 'IDLE_MOVEMENT'])

    def test_stricter_rule_abstains_without_changing_labels(self):
        members = np.repeat(np.array([[[.99,.005,.005],[.70,.10,.20],[.10,.05,.85]]]),3,axis=0)
        truth = np.array(['HELLO','IDLE_MOVEMENT','IDLE_MOVEMENT'])
        selected = select_rule(members,self.labels,truth)
        self.assertEqual(selected['validation']['nonSignFalseSignAccepted'],0)
        self.assertEqual(selected['validation']['signCorrectAccepted'],1)
        before,accepted = decisions(members,self.labels,BASE_RULE)
        after,_ = decisions(members,self.labels,selected['rule'])
        np.testing.assert_array_equal(before,after)
        self.assertEqual(accepted.tolist(),[True,True,False])

    def test_identical_confident_idle_and_sign_cannot_be_separated(self):
        members = np.repeat(np.array([[[.99,.005,.005],[.99,.005,.005]]]),3,axis=0)
        selected = select_rule(members,self.labels,np.array(['HELLO','IDLE_MOVEMENT']))
        self.assertEqual(selected['validation']['nonSignFalseSignAccepted'],1)
        self.assertEqual(selected['validation']['signCorrectAccepted'],1)

    def test_ensemble_disagreement_can_reject_false_accept(self):
        members = np.array([[[.99,.005,.005],[.8,.1,.1]],[[.99,.005,.005],[.8,.1,.1]],[[.99,.005,.005],[.3,.05,.65]]])
        truth=np.array(['HELLO','IDLE_MOVEMENT'])
        selected=select_rule(members,self.labels,truth)
        self.assertEqual(selected['validation']['nonSignFalseSignAccepted'],0)
        self.assertGreaterEqual(selected['validation']['signCorrectAccepted'],selected['minimumCorrectAccepted'])

if __name__=='__main__': unittest.main()
