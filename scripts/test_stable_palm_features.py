import unittest
import numpy as np
from stable_palm_features import scale_floor


class PalmScaleTests(unittest.TestCase):
    def make_vectors(self):
        names = ['wrist', 'index_mcp', 'middle_mcp', 'ring_mcp', 'pinky_mcp']
        order = ['leftHand.present'] + [f'leftHand.{n}.{a}' for n in names for a in 'xy']
        v = np.zeros((5, len(order)))
        v[:, 0] = 1
        for name in names[1:]:
            v[:, order.index(f'leftHand.{name}.y')] = 1
        return v, order

    def test_transient_middle_mcp_collapse_has_floor(self):
        v, order = self.make_vectors()
        v[2, order.index('leftHand.middle_mcp.y')] = .01
        original, stable = scale_floor(v, order, 'leftHand')
        self.assertAlmostEqual(original[2], .01)
        np.testing.assert_allclose(stable, 1)

    def test_missing_frames_do_not_change_reference_and_scale_equivariance(self):
        v, order = self.make_vectors()
        v[0, 0] = 0
        v[0, 1:] = 100
        _, stable = scale_floor(v, order, 'leftHand')
        np.testing.assert_allclose(stable[1:], 1)
        scaled = v.copy()
        scaled[:, 1:] *= 3
        _, other = scale_floor(scaled, order, 'leftHand')
        np.testing.assert_allclose(other, stable * 3)

    def test_absent_hand_remains_finite(self):
        v, order = self.make_vectors()
        v[:] = 0
        original, stable = scale_floor(v, order, 'leftHand')
        np.testing.assert_array_equal(original, stable)
        self.assertTrue(np.isfinite(stable).all())


if __name__ == '__main__':
    unittest.main()
