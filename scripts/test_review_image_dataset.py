"""Review automation checks using synthetic images and injected landmarks only."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
from prepare_image_dataset import DEFAULTS, process_sample, write, decide, digest
from test_prepare_image_dataset import FixtureExtractor
from review_image_dataset import analyze, generate, apply, outliers, load_review_request


class ReviewTests(unittest.TestCase):
    def setUp(self):
        base=Path(__file__).resolve().parents[1]/'.tmp/image-review-tests'
        base.mkdir(parents=True,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.source=self.root/'source'
        paths=['A/shared.png','B/shared.png','A/copy.png','B/conflict.png','A/similar.png','A/bad.png']
        self.catalog=dict(version=1,source_root=str(self.source),source_layout='static',samples=[])
        self.rows=[]
        self.vectors={}
        for i,relative in enumerate(paths):
            path=self.source/relative
            path.parent.mkdir(parents=True,exist_ok=True)
            if i==5:
                path.write_bytes(b'broken image')
            else:
                Image.new('RGB',(64,64),'red' if i in (0,2,3) else 'blue' if i==1 else 'green').save(path)
            sample=dict(id=f'sample-{i}',kind='static',label=relative[0],frames=[relative],original_path=relative,
                source_dataset='fixture',signer_id=None,session_id=None,recording_id=None,mirrored=None,
                mapping_verified=False,sign_correctness_verified=False,static_suitability_verified=False,
                duplicate_reviewed=False,quality_reviewed=False,review_notes='',include=True)
            self.catalog['samples'].append(sample)
            row=process_sample(sample,self.source,DEFAULTS,FixtureExtractor)
            row['leakage_group']='source-one'
            if i==4:
                row['warnings'].append('likely_visual_duplicate:sample-1')
            self.rows.append(row)
            if row['extracted_frames']:
                self.vectors[sample['id']]=row['extracted_frames'][0]['static_features']
        self.prepared=self.root/'prepared'
        self.prepared.mkdir()
        write(self.prepared/'catalog.snapshot.json',self.catalog)
        write(self.prepared/'report.json',dict(source_root=str(self.source)))
        for name in ('manifest.jsonl','extraction-checkpoint.jsonl'):
            with (self.prepared/name).open('w',encoding='utf-8') as f:
                for row in self.rows:
                    data=row if name.startswith('extraction') else {k:v for k,v in row.items() if k!='extracted_frames'}
                    f.write(json.dumps(data)+'\n')

    def test_filename_is_not_duplicate_identity_and_conflicts_are_pending(self):
        proposed,decisions,groups,pairs=analyze(self.catalog,self.rows,self.vectors)
        self.assertEqual(len(groups),1)
        self.assertEqual(set(groups[0]['sample_ids']),{'sample-0','sample-2','sample-3'})
        self.assertTrue(groups[0]['label_conflict'])
        self.assertIsNone(groups[0]['representative'])
        self.assertIn('label_conflict',decisions['sample-0']['pending'])
        self.assertNotIn('label_conflict',decisions['sample-1']['pending'])
        self.assertTrue(proposed['samples'][4]['include'])
        self.assertIn('similarity',decisions['sample-4']['pending'])
        self.assertEqual(decisions['sample-5']['action'],'exclude_technical')
        self.assertTrue(all(not s['sign_correctness_verified'] for s in proposed['samples']))

    def test_same_label_exact_copies_have_one_representative(self):
        catalog=copy.deepcopy(self.catalog)
        rows=copy.deepcopy(self.rows)
        catalog['samples'][3]['label']=rows[3]['label']='A'
        proposed,decisions,groups,_=analyze(catalog,rows,self.vectors)
        group=groups[0]
        self.assertFalse(group['label_conflict'])
        self.assertEqual(sum(s['include'] for s in proposed['samples'] if s['id'] in group['sample_ids']),1)
        self.assertEqual(sum(d['action']=='exclude_redundant_exact_copy' for d in decisions.values()),2)
        self.assertTrue(all(s['include'] for s in self.catalog['samples']))

    def test_render_apply_and_original_preservation(self):
        before=digest((self.prepared/'catalog.snapshot.json').read_bytes())
        package=self.root/'review'
        report=generate(self.prepared,package,pagesize=8)
        self.assertFalse(report['training_ready'])
        self.assertFalse(report['independent_evaluation_established'])
        self.assertTrue(list((package/'sheets').glob('*.jpg')))
        with Image.open(next((package/'sheets').glob('*.jpg'))) as image:
            self.assertEqual(image.width,1200)
        request=json.loads((package/'review-decisions.json').read_text())
        request['dataset_metadata'].update(confirmed=True,sign_language='SYNTHETIC TEST',alphabet_variant='TEST',
            mirrored=False,notes='Synthetic approval only; no real sign evidence.')
        for batch in request['batches'].values():
            batch.update(approve=True,mapping_verified=True,sign_correctness_verified=True,
                static_suitability_verified=True,accept_similarity=True,accept_outliers=True,notes='Reviewed synthetic fixtures.')
        write(package/'review-decisions.json',request)
        output=self.root/'reviewed.json'
        apply(package,package/'review-decisions.json',output)
        updated=json.loads(output.read_text())
        self.assertTrue(updated['samples'][0]['sign_correctness_verified'])
        self.assertFalse(updated['samples'][5]['include'])
        self.assertIn('label_conflict',updated['samples'][0]['reviewAutomation']['pending'])
        row=dict(self.rows[0],**updated['samples'][0])
        decide([row])
        self.assertIn('review_required:label_conflict',row['inclusion_reasons'])
        self.assertEqual(before,digest((self.prepared/'catalog.snapshot.json').read_bytes()))

    def test_approval_requires_evidence_and_changed_sources_are_excluded(self):
        (self.source/'A/shared.png').write_bytes(b'changed after extraction')
        package=self.root/'review'
        report=generate(self.prepared,package,pagesize=8)
        self.assertEqual(report['stale_or_missing_sources'],1)
        proposal=json.loads((package/'proposed-catalog.json').read_text())
        self.assertFalse(proposal['samples'][0]['include'])
        request=json.loads((package/'review-decisions.json').read_text())
        request['batches']['letter-A']['approve']=True
        write(package/'review-decisions.json',request)
        with self.assertRaisesRegex(ValueError,'confirmed dataset metadata'):
            apply(package,package/'review-decisions.json',self.root/'bad-approval.json')

    def test_robust_outlier_is_review_only(self):
        rows=[]
        vectors={}
        for i in range(30):
            sid=str(i)
            v=np.zeros(128)
            v[0]=1
            v[1:64]=1+(i%3)*.01
            if i==29:
                v[1:64]=100
            rows.append(dict(id=sid,label='A',technically_valid=True))
            vectors[sid]=v.tolist()
        self.assertIn('29',outliers(rows,vectors))

    def test_relabel_resets_semantic_approval_and_mirroring_override_wins(self):
        package=self.root/'review'
        generate(self.prepared,package,pagesize=8)
        request=json.loads((package/'review-decisions.json').read_text())
        request['dataset_metadata'].update(confirmed=True,sign_language='TEST',alphabet_variant='TEST',
            mirrored=False,notes='Synthetic documented source.')
        request['batches']['letter-A'].update(approve=True,mapping_verified=True,
            sign_correctness_verified=True,static_suitability_verified=True,notes='Synthetic batch review.')
        request['samples']['sample-4']=dict(action='keep',label='C',mirrored=True,
            quality_findings_accepted=True,notes='Synthetic relabel: previous approval must reset.')
        write(package/'review-decisions.json',request)
        result=self.root/'new-label.json'
        apply(package,package/'review-decisions.json',result)
        sample=next(s for s in json.loads(result.read_text())['samples'] if s['id']=='sample-4')
        self.assertEqual(sample['label'],'C')
        self.assertFalse(sample['sign_correctness_verified'])
        self.assertTrue(sample['mirrored'])
        self.assertTrue(sample['quality_reviewed'])

    def test_verified_rename_preserves_identity_and_original_path(self):
        package=self.root/'review'
        generate(self.prepared,package,pagesize=8)
        request=json.loads((package/'review-decisions.json').read_text())
        old=self.source/'A/shared.png'
        checksum=digest(old.read_bytes())
        old.rename(self.source/'A/1.png')
        request['source_path_updates']={'sample-0':dict(
            **{'from':'A/shared.png'},to='A/1.png',sha256=checksum)}
        request['samples']['sample-0']=dict(action='exclude',notes='Incorrect target handshape.')
        write(package/'review-decisions.json',request)
        result=self.root/'renamed.json'
        apply(package,package/'review-decisions.json',result)
        row=next(s for s in json.loads(result.read_text())['samples'] if s['id']=='sample-0')
        self.assertEqual(row['frames'],['A/1.png'])
        self.assertEqual(row['original_path'],'A/shared.png')
        self.assertFalse(row['include'])
        self.assertEqual(row['sourcePathHistory'][0]['sha256'],checksum)
        request['source_path_updates']['sample-0']['sha256']='0'*64
        write(package/'review-decisions.json',request)
        with self.assertRaisesRegex(ValueError,'Rename checksum differs'):
            apply(package,package/'review-decisions.json',self.root/'invalid-rename.json')

    def test_compact_decisions_enforce_managed_exclusions_and_integrity(self):
        package=self.root/'review'
        generate(self.prepared,package,pagesize=8)
        path=package/'review-decisions.json'
        request=json.loads(path.read_text())
        managed=package/'review-managed.json'
        write(managed,dict(version=1,excluded_labels=['B'],samples={
            'sample-0':dict(action='exclude',notes='Invalid thumb placement.')},source_path_updates={}))
        request['batches'].pop('letter-B')
        request['dataset_metadata'].update(confirmed=True,sign_language='TEST',alphabet_variant='TEST',
            notes='Synthetic metadata only.')
        request['batches']['letter-A'].update(approve=True,mapping_verified=True,
            sign_correctness_verified=True,static_suitability_verified=True,notes='Synthetic batch review.')
        request['managed_decisions']=dict(path=managed.name,sha256=digest(managed.read_bytes()))
        write(path,request)
        result=self.root/'compact-reviewed.json'
        apply(package,path,result)
        samples={s['id']:s for s in json.loads(result.read_text())['samples']}
        self.assertFalse(samples['sample-0']['include'])
        self.assertFalse(samples['sample-0']['sign_correctness_verified'])
        self.assertTrue(all(not s['include'] for s in samples.values() if s['label']=='B'))
        request['samples']['sample-0']=dict(action='keep',notes='Attempted accidental override.')
        write(path,request)
        with self.assertRaisesRegex(ValueError,'Cannot override a managed'):
            load_review_request(path)
        managed.write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Managed review decisions changed'):
            load_review_request(path)


if __name__=='__main__':
    unittest.main()
