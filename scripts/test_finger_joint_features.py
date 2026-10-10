import unittest
import numpy as np
from finger_joint_features import geometry, resample, feature_names, FINGERS


class FingerJointTests(unittest.TestCase):
    def setUp(self):
        self.order = []
        values = []
        for side in ('left', 'right'):
            self.order.append(side+'Hand.present')
            values.append(1.)
            points = {'wrist': (0., 0.)}
            for finger in FINGERS:
                for joint, y in zip(('mcp', 'pip', 'dip', 'tip'), (1., 2., 3., 4.)):
                    points[finger+'_'+joint] = (0., y)
            for name, point in points.items():
                for axis, value in zip('xy', point):
                    self.order.append(f'{side}Hand.{name}.{axis}')
                    values.append(value)
        self.v = np.array([values])

    def test_angles_and_separate_fingers(self):
        before = geometry(self.v, self.order)
        self.assertEqual(before.shape, (1, len(feature_names())))
        np.testing.assert_array_equal(before[0, 1:5], -np.ones(4))
        np.testing.assert_array_equal(before[0, 6:10], -np.ones(4))
        self.v[0, self.order.index('leftHand.index_tip.x')] = 1
        self.v[0, self.order.index('leftHand.index_tip.y')] = 3
        after = geometry(self.v, self.order)
        self.assertAlmostEqual(after[0, 6], 0)
        np.testing.assert_array_equal(after[0, 7:], before[0, 7:])
        np.testing.assert_array_equal(after[0, :6], before[0, :6])

    def test_translation_scale(self):
        other = self.v.copy()
        for i, name in enumerate(self.order):
            if name.endswith('.x'): other[:, i] = 3*other[:, i]+7
            if name.endswith('.y'): other[:, i] = 3*other[:, i]-4
        np.testing.assert_allclose(geometry(other, self.order), geometry(self.v, self.order))

    def test_missing_degenerate_groups(self):
        self.v[0, self.order.index('leftHand.present')] = 0
        self.v[0, self.order.index('rightHand.index_tip.y')] = 3
        out = geometry(self.v, self.order)
        self.assertFalse(out[0, :10].any())
        self.assertEqual(out[0, 10], 1)
        self.assertFalse(out[0, 15:].any())

    def test_interpolation_masks(self):
        good = geometry(self.v, self.order)
        frames = np.concatenate([good, np.zeros_like(good), good])
        out = resample(frames, 5)
        self.assertFalse(out[1:4].any())
        np.testing.assert_array_equal(out[[0,4]], np.repeat(good, 2, axis=0))
        np.testing.assert_array_equal(resample(good, 40), np.repeat(good, 40, axis=0))
