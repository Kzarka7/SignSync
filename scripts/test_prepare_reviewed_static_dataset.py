"""Cached static preparation checks; synthetic pixels/landmarks, no training."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from prepare_image_dataset import prepare, read, write, digest, decide
from prepare_reviewed_static_dataset import prepare_reviewed_static
from test_prepare_image_dataset import make_fixture, FixtureExtractor


class ReviewedStaticTests(unittest.TestCase):
    def setUp(self):
        base=Path(__file__).resolve().parents[1]/'.tmp/reviewed-static-tests'
        base.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        catalog=make_fixture(self.root)
        self.extracted=self.root/'extracted'
        prepare(self.root,self.root/'catalog.json',self.extracted,{},FixtureExtractor,fixture=True)
        catalog['samples']=[s for s in catalog['samples'] if s['kind']=='static']
        for s in catalog['samples']:
            s.update(signer_id=None,mirrored=None,quality_reviewed=True,duplicate_reviewed=True,
                     review_notes='Reviewed synthetic fixtures; no real signs are represented.')
            if s['frames'][0].endswith('/corrupt.png'):
                s['include']=False
        self.catalog=self.root/'reviewed.json'
        write(self.catalog,catalog)

    def run_prepare(self,name):
        return prepare_reviewed_static(self.extracted,self.catalog,self.root/name,
            expected_labels=['FIXTURE_HANDSHAPE'])

    def test_train_pool_and_deterministic_arrays(self):
        report=self.run_prepare('first')
        self.assertEqual(report['retained_samples'],9)
        self.assertEqual(report['connected_groups'],1)
        self.assertEqual(report['split_counts'],dict(training=9,validation=0,test=0))
        self.assertEqual(report['unknown_mirroring'],9)
        self.assertTrue(report['preparation_ready'])
        self.assertFalse(report['evaluation_ready'])
        self.assertFalse(report['model_trained'])
        self.assertIsNone(report['model_accuracy'])
        self.assertTrue(report['fixture'])
        self.assertEqual(report['included_exact_duplicates'],0)
        self.run_prepare('second')
        with np.load(self.root/'first/static_data.npz') as a, np.load(self.root/'second/static_data.npz') as b:
            for key in a.files:
                np.testing.assert_array_equal(a[key],b[key])
            self.assertEqual(a['X_train'].shape,(9,128))
            self.assertEqual(a['X_test'].shape,(0,128))
        manifest=[json.loads(l) for l in (self.root/'first/manifest.jsonl').read_text().splitlines()]
        self.assertTrue(all(r['mirrored'] is None for r in manifest))
        schema=read(self.root/'first/feature_schema.json')
        self.assertEqual(len(schema['order']),128)
        self.assertEqual(len(set(schema['order'])),128)

    def test_changed_source_and_cache_fail_closed(self):
        c=read(self.catalog)
        source=self.root/c['samples'][1]['frames'][0]
        before=source.read_bytes()
        source.write_bytes(b'changed pixels')
        with self.assertRaisesRegex(ValueError,'Source image changed'):
            self.run_prepare('stale')
        self.assertFalse((self.root/'stale').exists())
        source.write_bytes(before)
        checkpoint=self.extracted/'extraction-checkpoint.jsonl'
        checkpoint.write_text(checkpoint.read_text()+'\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Extraction artifact checksum mismatch'):
            self.run_prepare('tampered')

    def test_only_reviewed_static_unknown_mirroring_is_permitted(self):
        sample=read(self.catalog)['samples'][1]
        row=dict(sample,exclusions=[],warnings=[])
        decide([row])
        self.assertIn('review_required:source_mirroring_unknown',row['inclusion_reasons'])
        decide([row],allow_reviewed_static_unknown_mirroring=True)
        self.assertTrue(row['included'])
        self.assertIsNone(row['mirrored'])
        temporal=copy.deepcopy(row)
        temporal['kind']='sequence'
        temporal['complete_sign_verified']=True
        decide([temporal],allow_reviewed_static_unknown_mirroring=True)
        self.assertFalse(temporal['included'])
        unreviewed=copy.deepcopy(row)
        unreviewed['quality_reviewed']=False
        decide([unreviewed],allow_reviewed_static_unknown_mirroring=True)
        self.assertFalse(unreviewed['included'])
        excluded=copy.deepcopy(row)
        excluded['include']=False
        decide([excluded],allow_reviewed_static_unknown_mirroring=True)
        self.assertFalse(excluded['included'])

    def test_held_out_values_do_not_influence_scaler(self):
        catalog=read(self.catalog)
        for i,s in enumerate(catalog['samples']):
            s['signer_id']=f'synthetic-signer-{i}'
        write(self.catalog,catalog)
        report=self.run_prepare('baseline')
        self.assertTrue(report['evaluation_ready'])
        held=set(report['tensors']['sample_ids']['validation']+report['tensors']['sample_ids']['test'])
        import prepare_reviewed_static_dataset as pipeline
        original=pipeline.load_reviewed_rows
        from unittest.mock import patch
        def changed(*args,**kwargs):
            c,rows,hashes=original(*args,**kwargs)
            for row in rows:
                if row['id'] in held:
                    row['extracted_frames'][0]['static_features']=[v*1000 for v in row['extracted_frames'][0]['static_features']]
            return c,rows,hashes
        with patch.object(pipeline,'load_reviewed_rows',changed):
            self.run_prepare('held-out-extremes')
        with np.load(self.root/'baseline/static_data.npz') as a,np.load(self.root/'held-out-extremes/static_data.npz') as b:
            np.testing.assert_array_equal(a['feature_mean'],b['feature_mean'])
            np.testing.assert_array_equal(a['feature_std'],b['feature_std'])
            self.assertFalse(np.array_equal(a['X_test'],b['X_test']))


if __name__=='__main__':
    unittest.main()
