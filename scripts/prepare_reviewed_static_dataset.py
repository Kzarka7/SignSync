"""Prepare and audit approved static features from a verified extraction cache.

No detector inference, classifier fitting, training, or deployment. A single
connected source group remains a training pool with empty evaluation splits.
"""
from __future__ import annotations
import argparse
from collections import Counter
import copy
import csv
from importlib.metadata import version
import json
from pathlib import Path
import platform
import shutil
import string

import numpy as np
from image_landmarks import HAND, static_features
from prepare_image_dataset import (DEFAULTS, decide, digest,
    group_and_split, inside, read, save_tensors, validate_catalog, write)

LETTERS=tuple(l for l in string.ascii_uppercase if l not in 'JZ')


def load_jsonl(path):
    records={}
    with path.open(encoding='utf-8') as handle:
        for line in handle:
            row=json.loads(line)
            if row['id'] in records:
                raise ValueError('Duplicate cached sample ID: '+row['id'])
            records[row['id']]=row
    return records


def verify_artifact(extracted, name, checksums):
    actual=digest((extracted/name).read_bytes())
    if checksums.get(name)!=actual:
        raise ValueError('Extraction artifact checksum mismatch: '+name)
    return actual


def load_reviewed_rows(extracted, catalog_path, review_decisions=None):
    catalog=read(catalog_path)
    validate_catalog(catalog)
    if any(s['kind']!='static' for s in catalog['samples']):
        raise ValueError('Only static image samples are accepted by this preparer.')
    checksums=read(extracted/'artifact_checksums.json')
    input_hashes={name:verify_artifact(extracted,name,checksums) for name in (
        'extraction-checkpoint.jsonl','manifest.jsonl','environment.json','settings.json','catalog.snapshot.json')}
    if read(extracted/'progress.json').get('stage')!='complete':
        raise ValueError('Original extraction has not completed.')
    receipt_path=catalog_path.with_suffix('.changes.json')
    if receipt_path.exists():
        receipt=read(receipt_path)
        if receipt['output_catalog_sha256']!=digest(catalog_path.read_bytes()):
            raise ValueError('Reviewed catalog changed after its approval receipt.')
        if review_decisions:
            if receipt['decisions_sha256']!=digest(review_decisions.read_bytes()):
                raise ValueError('Review decisions changed after this catalog; apply them to a new catalog first.')
            ref=read(review_decisions).get('managed_decisions')
            if ref:
                actual=digest(inside(review_decisions.parent,ref['path']).read_bytes())
                if actual!=ref['sha256'] or actual!=receipt.get('managed_decisions_sha256'):
                    raise ValueError('Managed review decisions do not match the approval receipt.')
    elif review_decisions:
        raise ValueError('A review decision file requires a matching applied-catalog receipt.')
    cached=load_jsonl(extracted/'extraction-checkpoint.jsonl')
    manifest=load_jsonl(extracted/'manifest.jsonl')
    source=Path(catalog.get('source_root') or read(extracted/'report.json')['source_root'])
    rows=[]
    for index,sample in enumerate(catalog['samples'],1):
        sid=sample['id']
        if sid not in cached or sid not in manifest:
            raise ValueError('Sample absent from verified extraction: '+sid)
        row=copy.deepcopy(cached[sid])
        for key,value in manifest[sid].items():
            if key!='extracted_frames':
                row[key]=copy.deepcopy(value)
        row.update(copy.deepcopy(sample))
        # Cached inclusion results belong to an older review. Recompute them.
        row['included']=False
        row['split']=None
        row['warnings']=list(dict.fromkeys(row.get('warnings',[])))
        resolved=[]
        if sample.get('mapping_verified') is True:
            resolved.append('uncertain_source_sign_variant_mapping')
        if sample.get('sign_correctness_verified') is True:
            resolved.append('sign_correctness_unverified')
        row['warnings']=[w for w in row['warnings'] if w not in resolved]
        row['exclusions']=list(cached[sid].get('exclusions',[]))
        if not sample.get('include',True):
            row['exclusions'].append('review_catalog_excluded')
        if len(sample.get('frames',[]))!=1 or len(row.get('frames_validation',[]))!=1:
            raise ValueError('Expected exactly one source image per static sample: '+sid)
        current=sample['frames'][0]
        validation=row['frames_validation'][0]
        validation['extraction_original_path']=validation['path']
        validation['path']=current
        if sample.get('include',True):
            path=inside(source,current)
            if digest(path.read_bytes())!=validation.get('sha256'):
                raise ValueError('Source image changed since extraction: '+current)
            frames=row.get('extracted_frames',[])
            if len(frames)!=1:
                raise ValueError('Missing cached static landmarks: '+sid)
            computed=np.asarray(static_features(frames[0]['raw']),dtype=float)
            stored=np.asarray(frames[0].get('static_features'),dtype=float)
            if computed.shape!=(128,) or stored.shape!=(128,) or not np.isfinite(computed).all():
                raise ValueError('Malformed static features: '+sid)
            if not np.allclose(computed,stored,rtol=0,atol=1e-12):
                raise ValueError('Cached static feature conversion differs from current implementation: '+sid)
            if any(computed[i] not in (0,1) for i in (0,64)) or not any(computed[i] for i in (0,64)):
                raise ValueError('Invalid hand presence flags: '+sid)
            for start in (0,64):
                if computed[start]==0 and np.any(computed[start:start+64]!=0):
                    raise ValueError('Missing-hand feature block must be zero: '+sid)
            frames[0]['static_features']=computed.tolist()
        rows.append(row)
        if index%2000==0:
            print(f'Verified cache and source files {index}/{len(catalog["samples"])}',flush=True)
    return catalog,rows,input_hashes


def duplicate_audit(rows):
    owners={}
    matches=[]
    for row in rows:
        if not row['included']:
            continue
        frame=row['frames_validation'][0]
        for key in ('sha256','pixel_sha256'):
            token=(key,frame.get(key))
            if not token[1]:
                continue
            if token in owners:
                other=owners[token]
                matches.append(dict(sample_id=row['id'],other_id=other['id'],basis=key,
                                    label_conflict=row['label']!=other['label']))
            else:
                owners[token]=row
    return matches


def verify_arrays(output, rows, tensors):
    selected=[r for r in rows if r['included']]
    by_id={r['id']:r for r in selected}
    info=tensors['static']
    with np.load(output/'static_data.npz',allow_pickle=False) as arrays:
        train_ids=info['sample_ids']['training']
        values=np.asarray([by_id[s]['extracted_frames'][0]['static_features'] for s in train_ids],dtype=np.float32)
        mean=values.astype(float).mean(axis=0,keepdims=True)
        std=values.astype(float).std(axis=0,keepdims=True)
        std[std<1e-6]=1
        np.testing.assert_array_equal(arrays['feature_mean'],mean)
        np.testing.assert_array_equal(arrays['feature_std'],std)
        all_ids=[]
        group_owners={}
        for split,suffix in [('training','train'),('validation','validation'),('test','test')]:
            ids=info['sample_ids'][split]
            all_ids.extend(ids)
            assert arrays['X_'+suffix].shape==(len(ids),128)
            assert arrays['y_'+suffix].shape==(len(ids),)
            assert np.isfinite(arrays['X_'+suffix]).all()
            expected=np.asarray([by_id[s]['extracted_frames'][0]['static_features'] for s in ids],dtype=np.float32).reshape((-1,128))
            np.testing.assert_allclose(arrays['X_'+suffix],((expected-mean)/std).astype(np.float32),rtol=0,atol=0)
            np.testing.assert_array_equal(arrays['y_'+suffix],[info['labels'].index(by_id[s]['label']) for s in ids])
            for sid in ids:
                group=by_id[sid]['leakage_group']
                if group in group_owners and group_owners[group]!=split:
                    raise ValueError('Connected provenance group crosses splits.')
                group_owners[group]=split
        assert len(all_ids)==len(set(all_ids))==len(selected)
        assert set(all_ids)==set(by_id)


def prepare_reviewed_static(extracted, catalog_path, output, review_decisions=None, expected_labels=LETTERS):
    extracted,catalog_path,output=map(Path,(extracted,catalog_path,output))
    if output.exists():
        raise ValueError('Output exists; choose a new versioned directory.')
    catalog,rows,inputs=load_reviewed_rows(extracted,catalog_path,review_decisions)
    source=Path(catalog.get('source_root') or read(extracted/'report.json')['source_root'])
    protected_source=source if catalog.get('source_root') else source/'inputs'
    if output.resolve().is_relative_to(protected_source.resolve()):
        raise ValueError('Prepared output must be outside the original image folder.')
    decide(rows,allow_reviewed_static_unknown_mirroring=True)
    actual_labels=sorted({r['label'] for r in rows if r['included']})
    if actual_labels!=sorted(expected_labels):
        raise ValueError('Included labels do not match expected static target labels: '+str(actual_labels))
    reviewed={s['id'] for s in catalog['samples'] if s.get('include',True)}
    included={r['id'] for r in rows if r['included']}
    if included!=reviewed:
        details={r['id']:r['inclusion_reasons'] for r in rows if r['id'] in reviewed-included}
        raise ValueError('Approved candidates still have preparation blockers: '+json.dumps(details))
    # Reuse connected signer/session/recording/content groups, including links
    # through excluded records. Never make up people or recording identities.
    settings=dict(DEFAULTS,**read(extracted/'settings.json'))
    print('Checking connected provenance and duplicate groups',flush=True)
    group_and_split(rows,settings,detect_duplicates=False)
    duplicates=duplicate_audit(rows)
    if duplicates:
        raise ValueError('Exact duplicates remain among retained samples: '+json.dumps(duplicates[:10]))
    output.mkdir(parents=True)
    tensors=save_tensors(rows,output,settings)
    verify_arrays(output,rows,tensors)
    selected=[r for r in rows if r['included']]
    order=[side+'.present' if axis is None else side+'.'+point+'.'+axis
        for side in ('leftHand','rightHand')
        for point,axis in [(None,None)]+[(p,a) for p in HAND for a in 'xyz']]
    schema=dict(version=1,length=128,order=order,normalization='Per hand: xyz minus wrist xyz, divided by 3D wrist-to-middle-MCP distance; missing/degenerate hand: 64 zeros.',
        coordinate_space='MediaPipe image-normalized coordinates; detector category slots retained as extracted',
        source_mirroring='Unknown values remain null; no image flipping or anatomical reassignment.',
        classifier_input='One 128-feature vector per static image; separate from temporal sign models.')
    write(output/'feature_schema.json',schema)
    label_map={label:i for i,label in enumerate(actual_labels)}
    write(output/'labels.json',dict(labels=actual_labels,label_to_index=label_map))
    raw=np.asarray([r['extracted_frames'][0]['static_features'] for r in selected],dtype=np.float32)
    np.savez_compressed(output/'raw_static_features.npz',X=raw,
        y=np.asarray([label_map[r['label']] for r in selected],dtype=np.int64),
        sample_ids=np.asarray([r['id'] for r in selected]),labels=np.asarray(actual_labels))
    counts=Counter(r['label'] for r in selected)
    split_counts={s:len(ids) for s,ids in tensors['static']['sample_ids'].items()}
    groups={r['leakage_group'] for r in selected}
    per_label={}
    for label in sorted({r['label'] for r in rows}):
        members=[r for r in rows if r['label']==label]
        active=[r for r in members if r['included']]
        hand_counts=Counter()
        for r in active:
            values=r['extracted_frames'][0]['static_features']
            hand_counts['left_only']+=bool(values[0] and not values[64])
            hand_counts['right_only']+=bool(values[64] and not values[0])
            hand_counts['both']+=bool(values[0] and values[64])
        per_label[label]=dict(source_samples=len(members),retained=len(active),excluded=len(members)-len(active),
            detected_hand_usage={k:hand_counts[k] for k in ('left_only','right_only','both')},
            split_counts={s:sum(r['split']==s for r in active) for s in split_counts})
    widths=[r['frames_validation'][0]['width'] for r in selected]
    heights=[r['frames_validation'][0]['height'] for r in selected]
    report=dict(version=1,fixture=read(extracted/'environment.json').get('fixture',False),
        source_samples=len(rows),retained_samples=len(selected),target_labels=actual_labels,label_count=len(actual_labels),
        excluded_samples=len(rows)-len(selected),per_label=per_label,
        exclusion_and_pending_reasons=dict(Counter(reason for r in rows for reason in set(r['inclusion_reasons']))),
        retained_warning_counts=dict(Counter(w.split(':')[0] for r in selected for w in set(r['warnings']))),
        class_balance=dict(min_count=min(counts.values()),max_count=max(counts.values()),
            max_to_min_ratio=max(counts.values())/min(counts.values()),smallest_classes=[l for l in actual_labels if counts[l]==min(counts.values())]),
        input_dimensions=dict(min_width=min(widths),max_width=max(widths),min_height=min(heights),max_height=max(heights)),
        included_exact_duplicates=len(duplicates),included_exact_label_conflicts=0,
        source_checksums_verified=len(reviewed),cached_feature_vectors_recomputed_and_verified=len(selected),
        unknown_mirroring=sum(r.get('mirrored') is None for r in selected),
        reliable_signer_ids=sum(bool(r.get('signer_id')) for r in selected),
        missing_recording_ids=sum(not r.get('recording_id') for r in selected),
        missing_session_ids=sum(not r.get('session_id') for r in selected),
        connected_groups=len(groups),split_counts=split_counts,
        array_verification='Passed: dimensions, finite values, exact ID/label alignment, train-only scaler, group isolation.',
        constant_feature_channels=int(np.sum(raw.std(axis=0,dtype=np.float64)<1e-6)),
        source_mirroring_policy='Retain null/source unchanged. Accept unknown mirroring only for static samples with explicit visual, mapping, suitability and quality approvals; never infer a mirror value.',
        preparation_ready=True,training_pool_prepared=True,
        evaluation_ready=tensors['static']['evaluation_ready'],
        unseen_person_evaluation_established=False,
        model_trained=False,model_accuracy=None,
        evaluation_performed='Dataset quality, class balance, cache/source integrity, duplicate and leakage audit only.',
        tensors=tensors['static'],
        remaining_requirements=['Provide independent, reviewed validation/test data with reliable signer/recording provenance before model selection or reporting generalization.',
            'Do not split this source randomly to manufacture held-out scores; adjacent frames/augmentations may be related.',
            'J and Z require complete temporal samples for full-letter recognition.'],
        notes=['No detector inference or classifier training was performed.',
            'Technical checks and recorded user visual approval are separate evidence.',
            'Mirroring and anatomical handedness are not independently verified.',
            'Presence flags and constant channels are retained in the schema; training-only standardization can map constant features to zero.'])
    write(output/'evaluation.json',report)
    write(output/'settings.json',dict(seed=settings['seed'],split_fractions=settings['split_fractions'],
        split_policy='connected provenance/content groups, including excluded samples',
        static_unknown_mirroring='allow after explicit visual and quality review; preserve null',
        normalization_fit='training only',target_labels=actual_labels,extractor_rerun=False))
    write(output/'catalog.snapshot.json',catalog)
    write(output/'splits.json',tensors['static']['sample_ids'])
    with (output/'manifest.jsonl').open('w',encoding='utf-8') as handle:
        for row in rows:
            record={k:v for k,v in row.items() if k!='extracted_frames'}
            record['landmarks_source']=str((extracted/row['landmarks_path']).resolve()) if row.get('landmarks_path') else None
            handle.write(json.dumps(record,ensure_ascii=False,allow_nan=False)+'\n')
    with (output/'class_counts.csv').open('w',encoding='utf-8',newline='') as handle:
        writer=csv.writer(handle)
        writer.writerow(['label','retained','training','validation','test','left_only','right_only','both'])
        for label in actual_labels:
            r=per_label[label]
            writer.writerow([label,r['retained'],*[r['split_counts'][s] for s in split_counts],
                             *[r['detected_hand_usage'][s] for s in ('left_only','right_only','both')]])
    lines=[f'# Prepared {len(actual_labels)}-letter static dataset','',
        f'Retained: **{len(selected):,}** images; labels: **{len(actual_labels)}**.',
        f'Splits: {split_counts}; connected groups: **{len(groups)}**.',
        '', ('**Training and evaluation arrays prepared. No model was trained or scored.**' if report['evaluation_ready'] else
             '**Training pool prepared. Model evaluation is not established. No model was trained.**'),
        '', 'The available provenance forms connected groups that cannot be split without risking related-image leakage. '
        'Empty validation/test arrays are intentional. Obtain an independent evaluation set before model selection or accuracy claims.',
        '', f'Exact duplicates among retained samples: **{len(duplicates)}**. Source checksums and all cached feature vectors verified.',
        f'Unknown source mirroring: **{report["unknown_mirroring"]:,}**; kept null, images and detector categories unchanged. '
        'Static visual approval permits preparation under the saved policy; it does not prove anatomical hand identity.',
        '', '| Letter | Retained | Train | Validation | Test |', '|---|---:|---:|---:|---:|']
    for label in actual_labels:
        r=per_label[label]
        lines.append(f'| {label} | {r["retained"]} | '+ ' | '.join(str(r['split_counts'][s]) for s in split_counts)+' |')
    lines += ['',f'Class counts range from {min(counts.values())} to {max(counts.values())}; largest/smallest ratio {report["class_balance"]["max_to_min_ratio"]:.2f}.',
        '', '`static_data.npz` contains standardized split arrays and the training-fitted scaler. '
        '`raw_static_features.npz` preserves all selected 128-channel vectors before standardization, IDs and labels. '
        '`feature_schema.json`, `splits.json` and `manifest.jsonl` define their interpretation.',
        '', 'Original images, review decisions, deployed models and recognition pages are unchanged. '
        'Existing per-sample landmark JSON files are referenced by stable ID rather than duplicated.',
        '', 'No recognition accuracy, F1 score or unseen-person performance is claimed.']
    (output/'REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    source_dir=output/'preparation_source'
    source_dir.mkdir()
    for name in ('prepare_reviewed_static_dataset.py','prepare_image_dataset.py','image_landmarks.py',
                 'preprocess_dataset.py','processed_paths.py','prepare_handshape_experiments.py','gesture_geometry.py'):
        shutil.copy2(Path(__file__).with_name(name),source_dir/name)
    shutil.copy2(extracted/'environment.json',output/'extraction_environment.json')
    receipt_path=catalog_path.with_suffix('.changes.json')
    if receipt_path.exists():
        shutil.copy2(receipt_path,output/'approval_receipt.json')
    if review_decisions:
        snapshots=output/'review_inputs'
        snapshots.mkdir()
        shutil.copy2(review_decisions,snapshots/review_decisions.name)
        if reference:=read(review_decisions).get('managed_decisions'):
            shutil.copy2(inside(review_decisions.parent,reference['path']),snapshots/Path(reference['path']).name)
    write(output/'reproduction.json',dict(extraction=str(extracted.resolve()),catalog=str(catalog_path.resolve()),
        catalog_sha256=digest(catalog_path.read_bytes()),extraction_artifact_sha256=inputs,
        python=platform.python_version(),packages={p:version(p) for p in ('numpy','Pillow')},
        cache_reuse='No inference rerun; raw landmark conversion recomputed and verified for every included image.',
        exact_command=['scripts/prepare_reviewed_static_dataset.py','--extracted',str(extracted.resolve()),
                       '--catalog',str(catalog_path.resolve()),'--output','CHOOSE_A_NEW_OUTPUT_DIRECTORY']+
                      (['--review-decisions',str(review_decisions.resolve())] if review_decisions else [])))
    write(output/'artifact_checksums.json',{p.relative_to(output).as_posix():digest(p.read_bytes())
        for p in sorted(output.rglob('*')) if p.is_file()})
    print(f'Prepared {len(selected)} static samples; evaluation_ready={report["evaluation_ready"]}; no training.',flush=True)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extracted',type=Path,required=True)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--review-decisions',type=Path)
    args=parser.parse_args()
    report=prepare_reviewed_static(args.extracted,args.catalog,args.output,args.review_decisions)
    print(json.dumps({k:report[k] for k in ('retained_samples','label_count','split_counts','connected_groups','evaluation_ready','model_trained')},indent=2))


if __name__=='__main__':
    main()
