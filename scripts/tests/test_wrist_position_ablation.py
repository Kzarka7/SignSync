"""The wrist/position removal must preserve all orientation and start channels."""
import unittest
from gesture_geometry import feature_names
from historical.run_wrist_position_ablation import retained_indices


class WristPositionAblationTests(unittest.TestCase):
    def test_only_eight_wrist_position_channels_removed(self):
        names = feature_names()
        keep, removed = retained_indices(dict(featureCount=238, geometryFeatureNames=names))
        self.assertEqual(removed, [200, 201, 202, 203, 214, 215, 216, 217])
        self.assertEqual(len(keep), 230)
        self.assertEqual(keep[:190], list(range(190)))
        for i, name in enumerate(names):
            if 'normal_' in name or 'first_observed_' in name:
                self.assertIn(190+i, keep)

    def test_unknown_schema_rejected(self):
        with self.assertRaises(ValueError):
            retained_indices(dict(featureCount=222, geometryFeatureNames=feature_names()))


if __name__ == '__main__': unittest.main()
