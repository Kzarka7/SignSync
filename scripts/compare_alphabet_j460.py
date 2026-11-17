"""Evaluate the previous alphabet checkpoint on a fixed source-clean comparison cohort."""
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault('TF_NUM_INTRAOP_THREADS', '2')
os.environ.setdefault('TF_NUM_INTEROP_THREADS', '1')
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix


def main():
    root = Path(__file__).resolve().parents[2] / 'SignSync Dataset'
    parent = root / 'models/candidates/alphabet_26_j460_v2'
    old = root / 'models/candidates/alphabet_26_mixed_v1/alphabet_26_mixed_v1_seed42'
    source = root / 'processed/image-datasets/alphabet-v2-j460'
    cohort = json.loads((parent / 'comparison-cohort.json').read_bytes())
    ids = cohort['ids']
    wanted = set(ids)
    checks = json.loads((old / 'artifact_checksums.json').read_bytes())
    for name, expected in checks.items():
        with (old / name).open('rb') as handle:
            assert hashlib.file_digest(handle, 'sha256').hexdigest() == expected, name
    meta = json.loads((old / 'metadata.json').read_bytes())
    labels = meta['labels']
    values, targets = {}, {}
    for filename, feature_key in [('static-24/raw_static_features.npz', 'X'), ('temporal-jz/raw_sequences.npz', 'X_hand')]:
        with np.load(source / filename, allow_pickle=False) as arrays:
            source_ids, source_values = arrays['sample_ids'].tolist(), arrays[feature_key].copy()
            source_labels, source_y = arrays['labels'].copy(), arrays['y'].copy()
            for i, sid in enumerate(source_ids):
                if sid not in wanted:
                    continue
                raw = source_values[i]
                values[sid] = raw[None] if raw.ndim == 1 else raw
                targets[sid] = labels.index(str(source_labels[source_y[i]]))
    with np.load(old / 'scalers.npz', allow_pickle=False) as arrays:
        mean, std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
    x = np.zeros((len(ids), 40, 128), dtype=np.float32)
    y = np.asarray([targets[sid] for sid in ids])
    for i, sid in enumerate(ids):
        raw = values[sid]
        x[i, :len(raw)] = ((raw.astype(np.float32) - mean) / std).astype(np.float32)
    import tensorflow as tf
    model = tf.keras.models.load_model(old / 'best_model.keras', compile=False)
    q = model.predict(x, batch_size=128, verbose=0)
    assert q.shape == (len(ids), 26) and np.isfinite(q).all()
    assert np.allclose(q.sum(1), 1, atol=1e-5)
    # Reproduce the saved original predictions to verify checkpoint/scaler parity.
    with np.load(old / 'prepared_data.npz', allow_pickle=False) as arrays:
        test = arrays['test_indices']
        original = model.predict(arrays['X'][test], batch_size=128, verbose=0)
        original_ids = arrays['sample_ids'][test]
    with np.load(old / 'predictions.npz', allow_pickle=False) as saved:
        np.testing.assert_array_equal(original_ids, saved['sample_ids'])
        np.testing.assert_allclose(original, saved['probabilities'], rtol=1e-3, atol=1e-5)
    np.savez_compressed(parent / 'previous-model-comparison-predictions.npz', probabilities=q, y_true=y, sample_ids=np.asarray(ids))
    loss = float(-np.log(np.maximum(q[np.arange(len(y)), y].astype(np.float64), np.finfo(np.float64).tiny)).mean())
    report = dict(accuracy=float((q.argmax(1) == y).mean()), loss=loss,
        classificationReport=classification_report(y, q.argmax(1), labels=range(26), target_names=labels, output_dict=True, zero_division=0),
        confusionMatrix=confusion_matrix(y, q.argmax(1), labels=range(26)).tolist(),
        originalCheckpointPredictionsReproduced=True, cohort=cohort)
    (parent / 'previous-model-comparison.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    print('Previous checkpoint comparison accuracy:', report['accuracy'], 'J:', report['classificationReport']['J'], flush=True)


if __name__ == '__main__':
    main()
