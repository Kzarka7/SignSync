"""Generate an image review package; apply explicit batch decisions to a NEW catalog.

No extraction, training, deletion, or automatic sign-correctness approval.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import copy
import csv
import html
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from prepare_image_dataset import read, write, digest, canonical, inside, slug, validate_catalog


def jsonl(path):
    with path.open(encoding='utf-8') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def components(rows, keys):
    parents = {r['id']: r['id'] for r in rows}
    def find(sid):
        while parents[sid] != sid:
            parents[sid] = parents[parents[sid]]
            sid = parents[sid]
        return sid
    owners = {}
    for r in rows:
        for f in r.get('frames_validation', []):
            for key in keys:
                if f.get(key):
                    token = (key, f[key])
                    if token in owners:
                        parents[find(r['id'])] = find(owners[token])
                    else:
                        owners[token] = r['id']
    groups = defaultdict(list)
    for r in rows:
        groups[find(r['id'])].append(r['id'])
    return [sorted(ids) for ids in groups.values() if len(ids) > 1]


def outliers(rows, vectors, min_samples=20, threshold=6.):
    """Robust within-label/hand-side distances. Review heuristic, never a label verdict."""
    groups = defaultdict(list)
    for r in rows:
        v = vectors.get(r['id'])
        if r.get('technically_valid') and v is not None:
            groups[(r['label'], bool(v[0]), bool(v[64]))].append(r['id'])
    result = {}
    for ids in groups.values():
        if len(ids) < min_samples:
            continue
        values = np.asarray([vectors[sid] for sid in ids], dtype=float)
        center = np.median(values, axis=0)
        scale = np.maximum(1.4826*np.median(np.abs(values-center), axis=0), .05)
        distance = np.sqrt(np.mean(((values-center)/scale)**2, axis=1))
        middle = np.median(distance)
        spread = max(float(1.4826*np.median(np.abs(distance-middle))), .05)
        for sid, d in zip(ids, distance):
            score = float((d-middle)/spread)
            if score > threshold:
                result[sid] = round(score, 4)
    return result


def analyze(catalog, rows, vectors, changed=None):
    if any(s['kind'] != 'static' for s in catalog['samples']):
        raise ValueError('This reviewer handles static-image catalogs only; temporal reviews remain separate.')
    entries = {s['id']: copy.deepcopy(s) for s in catalog['samples']}
    by_id = {r['id']: r for r in rows}
    if len(by_id) != len(rows) or set(entries) != set(by_id):
        raise ValueError('Catalog and extraction IDs differ; use the frozen catalog from the same run.')
    exact_groups = components(rows, ('sha256', 'pixel_sha256'))
    exact_membership = {sid: i for i, ids in enumerate(exact_groups) for sid in ids}
    pairs = set()
    for row in rows:
        for warning in row.get('warnings', []):
            if warning.startswith('likely_visual_duplicate:'):
                other = warning.split(':', 1)[1]
                if other in by_id and other != row['id']:
                    a, b = sorted((row['id'], other))
                    if a not in exact_membership or exact_membership.get(a) != exact_membership.get(b):
                        pairs.add((a,b))
    similar = defaultdict(set)
    for a,b in sorted(pairs):
        similar[a].add(b)
        similar[b].add(a)
    unusual = outliers(rows, vectors)
    changed = changed or {}
    decisions = {}
    for sid, sample in entries.items():
        row = by_id[sid]
        reasons = list(row.get('exclusions', []))
        if sid in changed:
            reasons.append('source_changed_since_extraction:' + changed[sid])
        decision = dict(action='candidate', technical_reasons=reasons,
            pending=[], exact_group=None, representative=None,
            similar_ids=sorted(similar[sid]), outlier_score=unusual.get(sid))
        if reasons:
            decision['action'] = 'exclude_technical'
            sample['include'] = False
        elif sample.get('include') is False:
            decision['action'] = 'preserve_existing_exclusion'
        if similar[sid]:
            decision['pending'].append('similarity')
        if sid in unusual:
            decision['pending'].append('landmark_outlier')
        decisions[sid] = decision
    group_records = []
    for ids in exact_groups:
        gid = 'exact-' + digest(canonical(ids))[:16]
        labels = sorted({entries[sid]['label'] for sid in ids})
        candidates = [sid for sid in ids if not decisions[sid]['technical_reasons'] and entries[sid].get('include', True)]
        # Prefer the largest decoded image, then stable ID. Never prefer its filename.
        def rank(sid):
            f = by_id[sid]['frames_validation'][0]
            return (-f.get('width',0)*f.get('height',0), sid)
        representative = min(candidates, key=rank) if candidates and len(labels)==1 else None
        for sid in ids:
            d = decisions[sid]
            d.update(exact_group=gid, representative=representative)
            if len(labels)>1:
                d['pending'].append('label_conflict')
            elif sid != representative and d['action']=='candidate':
                d['action'] = 'exclude_redundant_exact_copy'
                entries[sid]['include'] = False
            if representative and not d['similar_ids']:
                # This flag covers a deterministic content check only, not visual or semantic review.
                entries[sid]['duplicate_reviewed'] = True
        group_records.append(dict(id=gid, sample_ids=ids, labels=labels,
                                  representative=representative, label_conflict=len(labels)>1))
    for sid, sample in entries.items():
        d = decisions[sid]
        sample['reviewAutomation'] = dict(policy='static-review-v1', **d)
        note = 'Automated technical proposal: ' + d['action']
        if d['representative']:
            note += '; exact-copy representative=' + d['representative']
        sample['review_notes'] = (sample.get('review_notes','').strip() + '\n' + note).strip()
    proposed = copy.deepcopy(catalog)
    proposed['samples'] = [entries[s['id']] for s in catalog['samples']]
    return proposed, decisions, group_records, sorted(pairs)


def font(size):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/arial.ttf', size)
    except OSError:
        return ImageFont.load_default()


def sheets(output, title, ids, records, source, decisions, pagesize=80):
    """Thumbnails of every requested item, paginated; never just a representative montage."""
    pages = []
    columns, cw, ch, header = 8, 150, 188, 60
    for offset in range(0,len(ids),pagesize):
        pageids = ids[offset:offset+pagesize]
        canvas = Image.new('RGB',(columns*cw, header+((len(pageids)+columns-1)//columns)*ch),'#f2f4f7')
        draw = ImageDraw.Draw(canvas)
        draw.text((12,8),title,fill='#142230',font=font(21))
        draw.text((12,34),f'{offset+1}-{offset+len(pageids)} of {len(ids)} | red: excluded; amber: review; green: candidate (meaning unverified)',fill='#334155',font=font(13))
        for i,sid in enumerate(pageids):
            row, decision = records[sid], decisions[sid]
            x,y = (i%columns)*cw,header+(i//columns)*ch
            color = '#dc2626' if decision['action'].startswith('exclude') else '#d97706' if decision['pending'] else '#15803d'
            draw.rectangle((x+3,y+3,x+cw-3,y+ch-3),fill='white',outline=color,width=3)
            try:
                with Image.open(inside(source,row['frames'][0])) as im:
                    thumb = ImageOps.contain(ImageOps.exif_transpose(im).convert('RGB'),(cw-12,123))
                canvas.paste(thumb,(x+(cw-thumb.width)//2,y+7+(123-thumb.height)//2))
            except (OSError,ValueError):
                draw.text((x+8,y+45),'UNREADABLE',fill='#dc2626',font=font(14))
            draw.text((x+8,y+132),f'{row["label"]} | {sid[4:16]}',fill='#142230',font=font(12))
            draw.text((x+8,y+148),Path(row['frames'][0]).name[:21],fill='#475569',font=font(10))
            caption = decision['action'].replace('exclude_','') if decision['action']!='candidate' else ', '.join(decision['pending']) or 'candidate'
            draw.text((x+8,y+163),caption[:23],fill=color,font=font(10))
        path = output/f'{slug(title)}-{offset//pagesize+1:03}.jpg'
        path.parent.mkdir(parents=True,exist_ok=True)
        canvas.save(path,quality=85)
        pages.append(path.name)
    return pages


def readiness(catalog, decisions, rows):
    candidates = [s for s in catalog['samples'] if s.get('include',True)]
    by_id = {r['id']:r for r in rows}
    per_label = {}
    for label in sorted({s['label'] for s in catalog['samples']}):
        samples = [s for s in catalog['samples'] if s['label']==label]
        per_label[label] = dict(total=len(samples), technically_valid=sum(by_id[s['id']].get('technically_valid',False) for s in samples),
            candidates=sum(s.get('include',True) for s in samples),
            flagged_candidates=sum(bool(decisions[s['id']]['pending']) for s in samples if s.get('include',True)))
    semantic = sum(not all(s.get(k) is True for k in ('mapping_verified','sign_correctness_verified','static_suitability_verified')) for s in candidates)
    mirroring = sum(s.get('mirrored') is None for s in candidates)
    pending = sum(bool(decisions[s['id']]['pending']) for s in candidates)
    known_signers = sum(bool(s.get('signer_id')) for s in candidates)
    # Actual importer already computes conservative connected provenance groups.
    groups = {by_id[s['id']].get('leakage_group') for s in candidates}
    groups.discard(None)
    evaluation = len(groups)>=3 and known_signers==len(candidates) and bool(candidates)
    return dict(training_ready=False, candidate_samples=len(candidates), per_label=per_label,
        semantic_review_pending=semantic, mirroring_unknown=mirroring, exception_review_pending=pending,
        reliable_signer_ids=known_signers, existing_connected_provenance_groups=len(groups),
        independent_evaluation_established=False,
        evaluation_candidate_conditions_met=evaluation,
        reasons=['Technical validity does not establish sign correctness.',
            'Review source language/alphabet variant and static suitability, including motion-dependent letters.',
            'Source-only grouping cannot establish unseen-person accuracy; independent groups and split label coverage must be checked.',
            'No training arrays, model training, or deployed-model changes are produced by this reviewer.'])


def generate(prepared, output, pagesize=80):
    if output.exists():
        raise ValueError('Review output exists; choose a new versioned directory.')
    catalog_path = prepared/'catalog.snapshot.json'
    catalog = read(catalog_path)
    manifest_path = prepared/'manifest.jsonl'
    rows = list(jsonl(manifest_path))
    vectors = {}
    checkpoint_path = prepared/'extraction-checkpoint.jsonl'
    for row in jsonl(checkpoint_path):
        fs = row.get('extracted_frames',[])
        if row.get('kind')=='static' and len(fs)==1:
            v = fs[0].get('static_features')
            if isinstance(v,list) and len(v)==128 and np.isfinite(v).all():
                vectors[row['id']] = v
    source = Path(catalog.get('source_root') or read(prepared/'report.json')['source_root'])
    changed = {}
    for i,row in enumerate(rows,1):
        for f in row.get('frames_validation',[]):
            try:
                if digest(inside(source,f['path']).read_bytes()) != f.get('sha256'):
                    changed[row['id']] = 'checksum_mismatch'
            except (OSError,ValueError):
                changed[row['id']] = 'missing_or_unreadable'
        if i%2000==0:
            print(f'Verified source checksums {i}/{len(rows)}',flush=True)
    proposed, decisions, groups, pairs = analyze(catalog,rows,vectors,changed)
    output.mkdir(parents=True)
    write(output/'proposed-catalog.json',proposed)
    write(output/'decisions.json',decisions)
    write(output/'exact-groups.json',groups)
    with (output/'similarity-pairs.csv').open('w',encoding='utf-8',newline='') as handle:
        writer=csv.writer(handle)
        writer.writerow(['sample_id_a','sample_id_b','meaning'])
        writer.writerows((a,b,'visual-similarity heuristic; not an exact-copy verdict') for a,b in pairs)
    records = {r['id']:r for r in rows}
    batches, sections = {}, []
    for label in sorted({r['label'] for r in rows}):
        ids = [r['id'] for r in rows if r['label']==label]
        batch = 'letter-'+label
        batches[batch] = ids
        title = batch+' - all samples'
        pages = sheets(output/'sheets',title,ids,records,source,decisions,pagesize)
        sections.append((title,pages))
        print(f'Rendered letter {label}: {len(ids)} samples',flush=True)
    categories = {
        'technical-exclusions':[sid for sid,d in decisions.items() if d['action']=='exclude_technical'],
        'exact-copy-groups':[sid for g in groups for sid in g['sample_ids']],
        'label-conflicts':[sid for sid,d in decisions.items() if 'label_conflict' in d['pending']],
        'similar-images':[s['id'] for s in proposed['samples'] if s.get('include',True) and 'similarity' in decisions[s['id']]['pending']],
        'landmark-outliers':[sid for sid,d in decisions.items() if 'landmark_outlier' in d['pending']],
    }
    for title,ids in categories.items():
        sections.append((title,sheets(output/'sheets',title,ids,records,source,decisions,pagesize)))
    write(output/'batches.json',batches)
    template=dict(dataset_metadata=dict(confirmed=False,source_dataset=catalog['samples'][0].get('source_dataset') if catalog['samples'] else None,
        original_source_name=None,sign_language=None,alphabet_variant=None,mirrored=None,notes=''),
        batches={batch:dict(approve=False,mapping_verified=False,sign_correctness_verified=False,
            static_suitability_verified=False,accept_similarity=False,accept_outliers=False,
            quality_findings_accepted=False,notes='') for batch in batches},
        samples={})
    write(output/'review-decisions.json',template)
    summary=readiness(proposed,decisions,rows)
    summary.update(total_samples=len(rows), automatic_actions=dict(Counter(d['action'] for d in decisions.values())),
        exact_duplicate_groups=len(groups), exact_extra_copies=sum(len(g['sample_ids'])-1 for g in groups),
        cross_label_exact_groups=sum(g['label_conflict'] for g in groups), similarity_pairs=len(pairs),
        landmark_outliers=sum(d['outlier_score'] is not None for d in decisions.values()),
        stale_or_missing_sources=len(changed), contact_sheet_pages=sum(len(p) for _,p in sections))
    write(output/'summary.json',summary)
    report=['# Automated image review','',f'Samples: {len(rows)}',f'Automatic actions: {summary["automatic_actions"]}',
        f'Candidate samples after technical checks and exact-copy selection: {summary["candidate_samples"]}',
        f'Exact-copy groups: {len(groups)}; groups with label conflicts: {summary["cross_label_exact_groups"]}',
        f'Landmark outliers (review only): {summary["landmark_outliers"]}',
        f'Connected provenance groups among candidates: {summary["existing_connected_provenance_groups"]}',
        '', '**Training readiness is not established.** No source, mirroring, semantic or visual approvals were invented.',
        '', 'Start with index.html. Review full letter sheets for batch semantic decisions and exception sheets for technical issues.',
        'Edit review-decisions.json once per letter/group, using samples only for overrides. Do not edit 11,700 catalog entries.',
        'Use the apply command to create a new catalog. Source images, original catalog, and original extraction are preserved.',
        '', 'Source-only grouping is not unseen-person evaluation. More reliable provenance or a separately collected evaluation set is needed.']
    (output/'REPORT.md').write_text('\n'.join(report)+'\n',encoding='utf-8')
    links=[]
    for title,pages in sections:
        links.append('<section><h2>'+html.escape(title)+'</h2>'+(''.join(
            f'<a href="sheets/{html.escape(p)}">Page {i+1}</a> ' for i,p in enumerate(pages)) or '<p>No findings.</p>')+'</section>')
    (output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Alphabet image review</title>'
        '<style>body{font:16px system-ui;max-width:1000px;margin:36px auto;padding:0 24px;background:#f8fafc;color:#172033}'
        'section{padding:8px 18px;margin:12px 0;background:white;border:1px solid #cbd5e1;border-radius:12px}'
        'a{display:inline-block;margin:4px 8px 8px 0;color:#1756a9}h2{font-size:18px}</style>'
        '<h1>Alphabet image review</h1><p>Technical proposals only. Sign correctness remains unverified.</p>'
        f'<p>{len(rows):,} samples · {summary["candidate_samples"]:,} technical candidates · '
        f'{summary["exact_extra_copies"]:,} extra exact copies</p>'
        '<p>Read <a href="REPORT.md">REPORT.md</a> and <a href="summary.json">summary.json</a>. '
        'Review every page of a letter before approving its batch in review-decisions.json. '
        'The first 12 ID characters on thumbnails map to full IDs in batches.json and decisions.json.</p>'+''.join(links),encoding='utf-8')
    package=dict(version=1,prepared=str(prepared.resolve()),source_root=str(source.resolve()),
        input_sha256={name:digest((prepared/name).read_bytes()) for name in ('catalog.snapshot.json','manifest.jsonl','extraction-checkpoint.jsonl')},
        frozen_sha256={name:digest((output/name).read_bytes()) for name in ('proposed-catalog.json','decisions.json','exact-groups.json','batches.json')},
        policy=dict(name='static-review-v1',outlier='within label/side: median/MAD; scale floor .05; min20; score>6',
            duplicates='byte or decoded-pixel equality; same-label representative; never filename equality',
            source_verification='current bytes compared to extraction SHA256',sign_correctness='manual batch approval only'))
    write(output/'package.json',package)
    shutil.copy2(Path(__file__),output/'review-script.py')
    return summary


def load_review_request(decisions_path):
    """Keep the editable letter decisions small; enforce audited managed rules."""
    request=read(decisions_path)
    reference=request.get('managed_decisions')
    if not reference:
        return request
    path=inside(decisions_path.parent,reference['path'])
    if digest(path.read_bytes())!=reference.get('sha256'):
        raise ValueError('Managed review decisions changed; regenerate their verified reference.')
    managed=read(path)
    if managed.get('version')!=1:
        raise ValueError('Unsupported managed review decisions version.')
    for key in ('samples','source_path_updates'):
        combined=copy.deepcopy(managed.get(key,{}))
        for sid,value in request.get(key,{}).items():
            if sid in combined and value!=combined[sid]:
                raise ValueError('Cannot override a managed exclusion or rename in the editable file: '+sid)
            combined[sid]=value
        request[key]=combined
    request['_managed_sha256']=reference['sha256']
    request['_managed_excluded_labels']=managed.get('excluded_labels',[])
    return request


def apply(package_dir, decisions_path, output):
    if output.exists():
        raise ValueError('Output catalog exists; choose a new filename.')
    package=read(package_dir/'package.json')
    for name,expected in package['frozen_sha256'].items():
        if digest((package_dir/name).read_bytes())!=expected:
            raise ValueError('Frozen review input changed: '+name)
    prepared=Path(package['prepared'])
    for name,expected in package['input_sha256'].items():
        if digest((prepared/name).read_bytes())!=expected:
            raise ValueError('Original extraction changed: '+name)
    catalog=read(package_dir/'proposed-catalog.json')
    decisions=read(package_dir/'decisions.json')
    batches=read(package_dir/'batches.json')
    request=load_review_request(decisions_path)
    samples={s['id']:s for s in catalog['samples']}
    for sample in samples.values():
        if sample['label'] in request.get('_managed_excluded_labels',[]):
            sample['include']=False
    # Batch approvals concern surviving candidates, including explicit manual
    # exclusions, rather than asserting correctness of rejected images.
    for sid,choice in request.get('samples',{}).items():
        if sid in samples and choice.get('action')=='exclude':
            samples[sid]['include']=False
    source=Path(package['source_root'])
    manifest={r['id']:r for r in jsonl(prepared/'manifest.jsonl')}
    path_updates=request.get('source_path_updates',{})
    destinations=set()
    for sid,change in path_updates.items():
        if sid not in samples:
            raise ValueError('Unknown renamed sample: '+sid)
        sample=samples[sid]
        original=manifest[sid].get('frames_validation',[])
        if sample.get('frames')!=[change.get('from')] or len(original)!=1:
            raise ValueError('Rename must match the frozen single-image source path: '+sid)
        expected=original[0].get('sha256')
        if not expected or change.get('sha256')!=expected:
            raise ValueError('Rename checksum differs from extraction: '+sid)
        destination=inside(source,change['to'])
        if str(destination).casefold() in destinations:
            raise ValueError('Multiple rename entries point to the same source file.')
        destinations.add(str(destination).casefold())
        if digest(destination.read_bytes())!=expected:
            raise ValueError('Renamed image content changed: '+sid)
        sample['frames']=[change['to']]
        sample.setdefault('sourcePathHistory',[]).append(dict(
            from_path=change['from'],to_path=change['to'],sha256=expected,
            reason='Verified filename-only rename; original sample ID and original_path preserved'))
    metadata=request.get('dataset_metadata',{})
    confirmed=metadata.get('confirmed') is True
    if confirmed and (not metadata.get('notes','').strip() or not metadata.get('sign_language') or not metadata.get('alphabet_variant')):
        raise ValueError('Confirmed metadata needs sign_language, alphabet_variant and evidence notes.')
    for batch,choice in request.get('batches',{}).items():
        if batch not in batches:
            raise ValueError('Unknown batch: '+batch)
        if choice.get('approve') is not True:
            continue
        if not confirmed or not choice.get('notes','').strip():
            raise ValueError('Batch approval needs confirmed dataset metadata and review notes.')
        for key in ('mapping_verified','sign_correctness_verified','static_suitability_verified'):
            if choice.get(key) is not True:
                raise ValueError('Batch approval requires explicit '+key)
        for sid in batches[batch]:
            s=samples[sid]
            if not s.get('include',True):
                continue
            for key in ('mapping_verified','sign_correctness_verified','static_suitability_verified'):
                s[key]=True
            s['review_notes']+='\nBatch visual review: '+choice['notes']
            if choice.get('quality_findings_accepted') is True:
                s['quality_reviewed']=True
            if isinstance(choice.get('mirrored'),bool):
                s['mirrored']=choice['mirrored']
            for field,flag in [('similarity','accept_similarity'),('landmark_outlier','accept_outliers')]:
                if choice.get(flag) is True:
                    decisions[sid]['pending']=[p for p in decisions[sid]['pending'] if p!=field]
            if 'similarity' not in decisions[sid]['pending']:
                s['duplicate_reviewed']=True
    for sid,choice in request.get('samples',{}).items():
        if sid not in samples:
            raise ValueError('Unknown sample: '+sid)
        s=samples[sid]
        if not choice.get('notes','').strip():
            raise ValueError('Individual decisions need notes: '+sid)
        action=choice.get('action')
        if action=='exclude':
            s['include']=False
        elif action=='keep':
            if s['label'] in request.get('_managed_excluded_labels',[]):
                raise ValueError('Label is excluded from this experiment by managed policy: '+s['label'])
            if decisions[sid]['technical_reasons']:
                raise ValueError('Re-extract/fix technical failures before keeping '+sid)
            s['include']=True
        else:
            raise ValueError('Individual action must be keep or exclude.')
        if choice.get('label'):
            if choice['label']!=s['label']:
                for key in ('mapping_verified','sign_correctness_verified','static_suitability_verified'):
                    s[key]=False
            s['label']=choice['label']
        for key in ('mapping_verified','sign_correctness_verified','static_suitability_verified'):
            if choice.get(key) is True:
                if not confirmed:
                    raise ValueError('Individual semantic approval needs confirmed dataset metadata.')
                s[key]=True
        if isinstance(choice.get('mirrored'),bool):
            s['mirrored']=choice['mirrored']
        if choice.get('quality_findings_accepted') is True:
            s['quality_reviewed']=True
        for field,flag in [('similarity','accept_similarity'),('landmark_outlier','accept_outlier')]:
            if choice.get(flag) is True:
                decisions[sid]['pending']=[p for p in decisions[sid]['pending'] if p!=field]
        s['review_notes']+='\nIndividual review: '+choice['notes']
    for group in read(package_dir/'exact-groups.json'):
        active=[samples[sid] for sid in group['sample_ids'] if samples[sid].get('include',True)]
        if len({s['label'] for s in active})<=1:
            for sid in group['sample_ids']:
                decisions[sid]['pending']=[p for p in decisions[sid]['pending'] if p!='label_conflict']
    for sid,s in samples.items():
        if s['label'] in request.get('_managed_excluded_labels',[]):
            s['include']=False
        if confirmed:
            s['sourceDocumentation']={k:v for k,v in metadata.items() if k!='confirmed'}
            if metadata.get('source_dataset'):
                s['source_dataset']=metadata['source_dataset']
            # Per-batch/sample decisions override a documented dataset-wide default.
            if isinstance(metadata.get('mirrored'),bool) and s.get('mirrored') is None:
                s['mirrored']=metadata['mirrored']
        if s.get('include',True):
            for index,f in enumerate(manifest[sid].get('frames_validation',[])):
                if digest(inside(source,s['frames'][index]).read_bytes())!=f.get('sha256'):
                    raise ValueError('Source changed; regenerate review after re-extraction: '+sid)
        s['reviewAutomation']=dict(s.get('reviewAutomation',{}),pending=decisions[sid]['pending'])
        if 'similarity' not in decisions[sid]['pending'] and s.get('mapping_verified') and s.get('sign_correctness_verified'):
            s['duplicate_reviewed']=True
    validate_catalog(catalog)
    write(output,catalog)
    write(output.with_suffix('.changes.json'),dict(review_package=str(package_dir.resolve()),
        decisions_sha256=digest(decisions_path.read_bytes()),output_catalog_sha256=digest(output.read_bytes()),
        managed_decisions_sha256=request.get('_managed_sha256'),
        verified_source_path_updates=len(path_updates),
        proposed_include=sum(s.get('include',True) for s in samples.values()),
        semantic_approved=sum(s.get('sign_correctness_verified') is True for s in samples.values()),
        unresolved_custom_findings=sum(bool(s['reviewAutomation']['pending']) for s in samples.values()),
        training_ready=False,note='Run preparation with this new catalog; inspect actual split coverage. No training was started.'))
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    gen=commands.add_parser('generate')
    gen.add_argument('--prepared',type=Path,required=True)
    gen.add_argument('--output',type=Path,required=True)
    gen.add_argument('--page-size',type=int,default=80)
    app=commands.add_parser('apply')
    app.add_argument('--package',type=Path,required=True)
    app.add_argument('--decisions',type=Path,required=True)
    app.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='generate':
        if not 8<=args.page_size<=100:
            parser.error('--page-size must be between 8 and 100')
        print(json.dumps(generate(args.prepared,args.output,args.page_size),indent=2))
    else:
        print(apply(args.package,args.decisions,args.output))


if __name__=='__main__':
    main()
