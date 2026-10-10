"""Verify the ablation removes orientation only, including its starting copy."""
import unittest
from gesture_geometry import feature_names
from run_orientation_ablation import retained_indices


class OrientationAblationTests(unittest.TestCase):
    def test_exact_channels_and_retained_starting_shape(self):
        names=feature_names()
        keep,removed=retained_indices(dict(featureCount=238,geometryFeatureNames=names))
        expected=[196,197,198,199,210,211,212,213,224,225,226,227,234,235,236,237]
        self.assertEqual(removed,expected)
        self.assertEqual(len(keep),222)
        self.assertEqual(keep[:190],list(range(190)))
        for i,name in enumerate(names):
            if 'first_observed_' in name and 'normal_' not in name:
                self.assertIn(190+i,keep)
            if any(k in name for k in ('wrist_', 'thumb_shoulder')):
                self.assertIn(190+i,keep)

    def test_reordered_schema_rejected(self):
        names=feature_names()
        names[0],names[1]=names[1],names[0]
        with self.assertRaises(ValueError):
            retained_indices(dict(featureCount=238,geometryFeatureNames=names))


if __name__=='__main__': unittest.main()
