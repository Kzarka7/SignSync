"""Check that cross-evaluation uses the supplied model's fitted scaling."""
import unittest
import numpy as np
from historical.run_recordings_v2_experiments import standardize_for_model


class NormalizationTests(unittest.TestCase):
    def test_each_model_uses_its_own_statistics(self):
        raw = np.full((2, 40, 238), 10.0)
        old_mean = np.full((1, 1, 238), 2.0)
        new_mean = np.full((1, 1, 238), 6.0)
        std = np.full((1, 1, 238), 2.0)
        np.testing.assert_array_equal(standardize_for_model(raw, old_mean, std), 4.0)
        np.testing.assert_array_equal(standardize_for_model(raw, new_mean, std), 2.0)
        self.assertEqual(standardize_for_model(raw, old_mean, std).dtype, np.float32)

    def test_rejects_invalid_statistics(self):
        raw = np.zeros((1, 40, 238))
        mean = np.zeros((1, 1, 238))
        for value in (0.0, -1.0, float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                standardize_for_model(raw, mean, np.full_like(mean, value))


if __name__ == '__main__':
    unittest.main()
