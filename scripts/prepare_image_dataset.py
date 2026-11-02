"""Index, validate, extract and split image datasets. Never trains a model.

Defaults to ../SignSync Dataset/image-import; see IMAGE_DATASETS.md.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import re
import shutil

import numpy as np
from PIL import Image, ImageOps
from image_landmarks import MediaPipeExtractor, SCHEMA, features, static_features
from preprocess_dataset import resample_sequence
from prepare_handshape_experiments import handshape, resample_shape
from gesture_geometry import geometry, resample as resample_geometry

ROOT = Path(__file__).resolve().parents[2] / 'SignSync Dataset' / 'image-import'
FORMATS = {'JPEG', 'PNG', 'WEBP', 'BMP', 'TIFF'}
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}
DEFAULTS = dict(version=1, seed=42, split_fractions=[.7, .15, .15], temporal_feature_set='geometry238',
                min_dimension=32, min_valid_fraction=.8, min_hand_fraction=.5,
                min_pose_visibility=.5, max_wrist_jump=1.5, max_gap_frames=5,
                near_duplicate_hamming=4,
                hand_model='.tmp/vision-check/hand.task', pose_model='.tmp/vision-check/pose.task')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def inside(root, relative):
    p = (root / relative).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ValueError('path escapes input root')
    return p


def slug(label):
    # Label itself is never rewritten. Only the storage directory is escaped.
    return re.sub(r'[^A-Za-z0-9_-]', '_', label)[:50] + '-' + digest(label.encode())[:8]


def scan(root, source=None, layout='mixed'):
    """A file directly under static/SIGN is one sample; a sequence directory is one sample."""
    rows, covered = [], set()
    reference = source or root
    inputs = source or root / 'inputs'
    folders = [('static', inputs / 'static'), ('sequence', inputs / 'sequences')] if layout == 'mixed' else [
        ('static' if layout == 'static' else 'sequence', inputs)]
    for kind, folder in folders:
        for sign in sorted(folder.iterdir() if folder.exists() else []):
            if not sign.is_dir():
                continue
            for path in sorted(sign.iterdir()):
                if kind == 'static' and (not path.is_file() or path.suffix.lower() not in EXTENSIONS):
                    continue
                if kind == 'sequence' and not path.is_dir():
                    continue
                rel = path.relative_to(reference).as_posix()
                sid = 'img-' + digest(canonical([str(source.resolve()) if source else None, kind, rel]))[:24]
                frames = [rel] if kind == 'static' else None
                if frames:
                    covered.update(frames)
                else:
                    covered.update(p.relative_to(reference).as_posix() for p in path.rglob('*') if p.is_file() and p.suffix.lower() in EXTENSIONS)
                rows.append(dict(id=sid, kind=kind, label=sign.name, source_label=sign.name,
                    source_dataset=None, original_path=rel, frames=frames,
                    timestamps_ms=None, fps=None, timing_reference=None,
                    signer_id=None, signer_namespace=None, recording_id=None, session_id=None,
                    related_group=None, mirrored=None, mapping_verified=False,
                    sign_correctness_verified=False, complete_sign_verified=False,
                    static_suitability_verified=False, duplicate_reviewed=False,
                    quality_reviewed=False, review_notes='', include=True))
    indexed = {r['original_path'] for r in rows}
    # Report loose/unsupported files rather than silently losing them.
    unindexed = [p.relative_to(reference).as_posix() for p in inputs.rglob('*')
                 if p.is_file() and p.relative_to(reference).as_posix() not in covered
                 and p.relative_to(reference).as_posix() not in indexed and p.name != '.gitkeep']
    return dict(version=1, source_root=str(source.resolve()) if source else None,
                source_layout=layout, samples=rows, unindexed_files=sorted(unindexed),
                unindexed_reasons={p: 'unsupported_extension' if Path(p).suffix.lower() not in EXTENSIONS
                    else 'outside_selected_sign_sample_layout' for p in sorted(unindexed)})


def validate_catalog(catalog):
    ids = [s['id'] for s in catalog['samples']]
    if len(ids) != len(set(ids)) or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', s) for s in ids):
        raise ValueError('sample IDs must be unique safe names, 1-100 characters')
    for s in catalog['samples']:
        if s['kind'] not in ('static', 'sequence') or not s.get('label', '').strip():
            raise ValueError('each sample needs kind static/sequence and a nonempty label')
        if s['label'] in ('.', '..') or any(c in s['label'] for c in '/\\<>:"|?*') or s['label'].endswith(('.', ' ')):
            raise ValueError('label must also be a safe sign folder name')
        for key in ('include', 'mapping_verified', 'sign_correctness_verified', 'complete_sign_verified',
                    'static_suitability_verified', 'duplicate_reviewed', 'quality_reviewed'):
            if key in s and not isinstance(s[key], bool):
                raise ValueError(key + ' must be boolean')
        if s.get('mirrored') is not None and not isinstance(s['mirrored'], bool):
            raise ValueError('mirrored must be true, false or null')


def timing(sample, count):
    if sample['kind'] == 'static':
        return [None], 'not-applicable'
    values = sample.get('timestamps_ms')
    if values is not None:
        t = np.asarray(values, dtype=float)
        if t.shape != (count,) or not np.isfinite(t).all() or t[0] < 0 or np.any(np.diff(t) < 1):
            raise ValueError('timestamps must match frames and increase by at least 1 ms')
        return t.tolist(), 'source-timestamps'
    fps = sample.get('fps')
    if fps is not None:
        if not np.isfinite(fps) or not 0 < fps <= 1000 or not sample.get('timing_reference'):
            raise ValueError('fps needs a positive value <=1000 and timing_reference documentation')
        return (np.arange(count) * 1000 / fps).tolist(), 'documented-fps'
    return [None] * count, 'unknown'


def image_info(path, settings):
    payload = path.read_bytes()
    with Image.open(path) as source:
        if source.format not in FORMATS or path.suffix.lower() not in EXTENSIONS:
            raise ValueError('unsupported image format')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('multi-frame image: export explicit ordered frames first')
        orientation = int(source.getexif().get(274, 1))
        if orientation not in range(1, 9):
            raise ValueError('invalid EXIF orientation')
        size, fmt = list(source.size), source.format
        source.load()
        image = ImageOps.exif_transpose(source).convert('RGB')
    if min(image.size) < settings['min_dimension']:
        raise ValueError('image dimensions below min_dimension')
    gray = np.asarray(image.convert('L').resize((9, 8)), dtype=int)
    dhash = sum(int(bit) << i for i, bit in enumerate((gray[:, 1:] > gray[:, :-1]).ravel()))
    return image, dict(sha256=digest(payload), pixel_sha256=digest(canonical(image.size) + image.tobytes()),
        width=image.width, height=image.height, source_dimensions=size, format=fmt,
        exif_orientation=orientation, orientation_applied=orientation != 1, dhash=f'{dhash:016x}')


@contextmanager
def extractor(settings, video, factory):
    model = factory(settings, video)
    try:
        yield model
    finally:
        model.close()


class ImageExtractorPool:
    """Reuse IMAGE-mode models; only VIDEO-mode models carry tracking state.

    Cache identical decoded inputs, never filenames. This avoids redundant
    inference for exact copies while preserving a separate record for each path.
    """
    def __init__(self, settings):
        self.model = MediaPipeExtractor(settings, False)
        self.cache = {}

    def detect(self, image, timestamp=None):
        key = digest(canonical(image.size) + image.tobytes())
        if key not in self.cache:
            self.cache[key] = self.model.detect(image, None)
        return dict(self.cache[key], timestamp=timestamp)

    def close(self):
        pass  # Borrowed IMAGE model; the run owner closes it once.

    def finish(self):
        self.model.close()


def process_sample(sample, root, settings, factory):
    row = dict(sample, warnings=[], exclusions=[], frames_validation=[], extracted_frames=[],
               technically_valid=False, included=False, split=None)
    errors, warnings = row['exclusions'], row['warnings']
    if not sample.get('include', True):
        errors.append('manually_excluded')
    for key in ('source_dataset', 'signer_id', 'recording_id', 'session_id', 'mirrored'):
        if sample.get(key) is None:
            warnings.append('missing_' + key)
    if not sample.get('source_dataset'):
        errors.append('source_dataset_required')
    if not sample.get('mapping_verified'):
        warnings.append('uncertain_source_sign_variant_mapping')
    if not sample.get('sign_correctness_verified'):
        warnings.append('sign_correctness_unverified')
    frames = sample.get('frames')
    if (not isinstance(frames, list) or not frames or
            any(not isinstance(p, str) or not p for p in frames) or len(set(frames)) != len(frames)):
        errors.append('missing_or_ambiguous_frame_order: supply unique paths in explicit order')
        return row
    if sample['kind'] == 'static' and len(frames) != 1:
        errors.append('static_sample_requires_exactly_one_image')
        return row
    if sample['kind'] == 'sequence' and len(frames) < 2:
        errors.append('single_image_cannot_be_temporal_sequence')
    try:
        timestamps, basis = timing(sample, len(frames))
    except (ValueError, TypeError) as e:
        errors.append('invalid_timing: ' + str(e))
        timestamps, basis = [None] * len(frames), 'invalid'
    row['timing_basis'] = basis
    if basis == 'unknown':
        warnings.append('unknown_timing: no duration or velocity claims; temporal export blocked')
    images = []
    for i, rel in enumerate(frames):
        info = dict(path=rel, index=i, timestamp=timestamps[i])
        try:
            image, metadata = image_info(inside(root, rel), settings)
            info.update(metadata)
            images.append(image)
            if metadata['orientation_applied']:
                warnings.append(f'exif_orientation_applied_in_memory:{i}')
        except (OSError, ValueError, Image.DecompressionBombError) as e:
            # Keep hashes of corrupt/unsupported files too, whenever readable.
            try:
                info['sha256'] = digest(inside(root, rel).read_bytes())
            except (OSError, ValueError):
                pass
            errors.append(f'invalid_image:{i}:{e}')
        row['frames_validation'].append(info)
    if len(images) != len(frames):
        return row
    if len({im.size for im in images}) > 1:
        warnings.append('inconsistent_frame_dimensions')
    video = sample['kind'] == 'sequence' and basis in ('source-timestamps', 'documented-fps')
    # Reset trackers per sample and per mirrored probe: no state crosses recordings.
    with extractor(settings, video, factory) as model, extractor(settings, False, factory) as probe:
        for i, image in enumerate(images):
            raw = model.detect(image, timestamps[i])
            values, valid = features(raw)
            mirrored = probe.detect(ImageOps.mirror(image), None)
            row['frames_validation'][i]['mirror_probe'] = dict(
                original=raw.get('handedness', []), flipped=mirrored.get('handedness', []),
                changed=raw.get('handedness', []) != mirrored.get('handedness', []))
            row['extracted_frames'].append(dict(timestamp=timestamps[i], raw=raw,
                features=values, valid=valid, static_features=static_features(raw)))
    fs = row['extracted_frames']
    counts = Counter()
    gap, longest, jumps, switches = 0, 0, 0, 0
    previous = None
    for f in fs:
        raw = f['raw']
        left, right = bool(raw['leftHand']), bool(raw['rightHand'])
        counts['left'] += left
        counts['right'] += right
        counts['both'] += left and right
        counts['neither'] += not (left or right)
        counts['pose'] += bool(raw['pose'])
        gap = 0 if left or right else gap + 1
        longest = max(longest, gap)
        pose = raw['pose']
        quality = bool(pose) and min(pose[n].get('visibility', 0) for n in ('leftShoulder', 'rightShoulder')) >= settings['min_pose_visibility']
        counts['usable_pose'] += quality and f['valid']
        if previous:
            for side, start in [('leftHand', 37), ('rightHand', 101)]:
                if f['valid'] and previous['valid'] and raw[side] and previous['raw'][side]:
                    jumps += np.linalg.norm(np.asarray(f['features'][start:start+3]) - previous['features'][start:start+3]) > settings['max_wrist_jump']
            switches += (bool(previous['raw']['leftHand']), bool(previous['raw']['rightHand'])) != (left, right)
        previous = f
    row['quality'] = dict(hand_usage=dict(counts), valid_fraction=sum(f['valid'] for f in fs) / len(fs),
        usable_pose_fraction=counts['usable_pose'] / len(fs), hand_fraction=1-counts['neither']/len(fs),
        longest_no_hand_gap_frames=longest, wrist_jump_count=int(jumps), presence_transition_count=int(switches))
    if jumps or longest >= settings['max_gap_frames']:
        warnings.append('tracking_discontinuity_requires_review')
    if any(len(f['raw'].get('handedness', [])) != len({h['label'] for h in f['raw'].get('handedness', [])}) for f in fs):
        warnings.append('ambiguous_handedness_requires_review')
    if counts['neither'] / len(fs) > 1-settings['min_hand_fraction']:
        errors.append('insufficient_hand_coverage')
    if sample['kind'] == 'sequence':
        if counts['usable_pose'] / len(fs) < settings['min_valid_fraction']:
            errors.append('insufficient_pose_normalization_quality')
        if basis not in ('source-timestamps', 'documented-fps'):
            errors.append('temporal_timing_required')
        if len({v['pixel_sha256'] for v in row['frames_validation']}) < 2:
            errors.append('sequence_has_only_one_distinct_image')
    else:
        if not any(fs[0]['static_features'][i] for i in (0, 64)):
            errors.append('no_nondegenerate_hand_for_static_features')
    row['technically_valid'] = not errors
    return row


def group_and_split(rows, settings, detect_duplicates=True):
    """Union every available provenance relation, not just the preferred group key."""
    parents = list(range(len(rows)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    def union(a, b):
        parents[find(b)] = find(a)
    owners, visual = {}, []
    for i, row in enumerate(rows):
        source = row.get('source_dataset') or 'UNKNOWN_SOURCE'
        tokens = []
        if row.get('signer_id'):
            tokens.append(('signer', row.get('signer_namespace') or source, row['signer_id']))
        for key in ('recording_id', 'session_id', 'related_group'):
            if row.get(key):
                tokens.append((key, source, row[key]))
        # Unknown signer samples also link through source, including any known signers there.
        if not row.get('signer_id'):
            tokens.append(('source_fallback', source))
        for f in row['frames_validation']:
            for key in ('sha256', 'pixel_sha256'):
                if f.get(key):
                    token = (key, f[key])
                    if token in owners and detect_duplicates:
                        row['warnings'].append(f'exact_duplicate:{rows[owners[token]]["id"]}:{f["index"]}')
                    tokens.append(token)
            if f.get('dhash'):
                value = int(f['dhash'], 16)
                for j, other in visual:
                    if j != i and (value ^ other).bit_count() <= settings['near_duplicate_hamming']:
                        if detect_duplicates:
                            row['warnings'].append('likely_visual_duplicate:' + rows[j]['id'])
                            rows[j]['warnings'].append('likely_visual_duplicate:' + row['id'])
                        union(i, j)  # Conservative: never leak review candidates across splits.
                visual.append((i, value))
        for token in tokens:
            if token in owners:
                union(i, owners[token])
            else:
                owners[token] = i
    # A source with unknown identities links to every other sample of that source.
    fallback = {r.get('source_dataset') or 'UNKNOWN_SOURCE' for r in rows if not r.get('signer_id')}
    by_source = {}
    for i, row in enumerate(rows):
        source = row.get('source_dataset') or 'UNKNOWN_SOURCE'
        if source in fallback:
            if source in by_source:
                union(i, by_source[source])
            by_source[source] = i
    components = defaultdict(list)
    for i, row in enumerate(rows):
        components[find(i)].append(row)
    groups = sorted(components.values(), key=lambda rs: digest(canonical([settings['seed'], sorted(r['id'] for r in rs)])))
    totals = Counter()
    fractions = settings['split_fractions']
    for group in groups:
        gid = 'group-' + digest(canonical(sorted(r['id'] for r in group)))[:20]
        active = [r for r in group if r['included']]
        split = min(range(3), key=lambda k: totals[k] / fractions[k]) if active else None
        if split is not None:
            totals[split] += len(active)
        for row in group:
            row['leakage_group'] = gid
            row['split'] = ('training', 'validation', 'test')[split] if row['included'] else None


def decide(rows, allow_reviewed_static_unknown_mirroring=False):
    for row in rows:
        blockers = list(row['exclusions'])
        if row.get('include') is False and 'manually_excluded' not in blockers:
            blockers.append('manually_excluded')
        for finding in row.get('reviewAutomation', {}).get('pending', []):
            blockers.append('review_required:' + finding)
        for field in ('mapping_verified', 'sign_correctness_verified'):
            if not row.get(field):
                blockers.append('review_required:' + field)
        field = 'complete_sign_verified' if row['kind'] == 'sequence' else 'static_suitability_verified'
        if not row.get(field):
            blockers.append('review_required:' + field)
        if row.get('mirrored') is None:
            accepted_static = (allow_reviewed_static_unknown_mirroring and row['kind']=='static' and
                all(row.get(k) is True for k in ('mapping_verified','sign_correctness_verified',
                                                'static_suitability_verified','quality_reviewed')))
            if accepted_static:
                warning='source_mirroring_unknown:preserved_after_static_visual_review'
                if warning not in row['warnings']:
                    row['warnings'].append(warning)
            else:
                blockers.append('review_required:source_mirroring_unknown')
        if row.get('mirrored') is True and not row.get('quality_reviewed'):
            blockers.append('review_required:mirrored_source_semantics')
        if any('duplicate' in w for w in row['warnings']) and not row.get('duplicate_reviewed'):
            blockers.append('review_required:duplicates')
        if any('requires_review' in w or 'inconsistent_frame_dimensions' in w for w in row['warnings']) and not row.get('quality_reviewed'):
            blockers.append('review_required:tracking_quality')
        if (row.get('quality_reviewed') or row.get('duplicate_reviewed')) and not row.get('review_notes', '').strip():
            blockers.append('review_note_required')
        row['inclusion_reasons'] = sorted(set(blockers))
        row['included'] = not blockers


def save_tensors(rows, output, settings):
    results = {}
    feature_count = 238 if settings['temporal_feature_set'] == 'geometry238' else 164
    for kind, name, shape in [('static', 'static_data.npz', (128,)), ('sequence', 'temporal_data.npz', (40, feature_count))]:
        usable = [r for r in rows if r['included'] and r['kind'] == kind]
        labels = sorted({r['label'] for r in usable})
        arrays, splits = {}, {}
        for split, suffix in [('training', 'train'), ('validation', 'validation'), ('test', 'test')]:
            subset = [r for r in usable if r['split'] == split]
            xs = []
            for r in subset:
                fs = r['extracted_frames']
                if kind == 'static':
                    xs.append(fs[0]['static_features'])
                else:
                    # Existing resampler is index-based. First map real time to uniform
                    # positions, then reuse it; irregular sampling is never treated as uniform.
                    t = np.asarray([f['timestamp'] for f in fs])
                    v = np.asarray([f['features'] for f in fs])
                    uniform = np.linspace(t[0], t[-1], 40)
                    def uniformize(channel):
                        return np.stack([np.interp(uniform, t, channel[:, j]) for j in range(channel.shape[1])], axis=1)
                    values = uniformize(v)
                    base = resample_sequence([dict(features=x.tolist()) for x in values], 40, r['id'])
                    if feature_count == 238:
                        # Compute nonlinear descriptors on observed frames, before time interpolation.
                        observed_geometry = geometry(v, SCHEMA['order'])
                        geometry_channels = resample_geometry(uniformize(observed_geometry), 40)
                        # The 20 first-observed descriptors refer to actual source
                        # detections, including observations between output timestamps.
                        geometry_channels[:, 28:] = resample_geometry(observed_geometry, 40)[:, 28:]
                        base = np.concatenate([base,
                            resample_shape(uniformize(handshape(v, SCHEMA['order'])), 40),
                            geometry_channels], axis=1)
                    xs.append(base)
            arrays['X_' + suffix] = np.asarray(xs, dtype=np.float32).reshape((-1, *shape))
            arrays['y_' + suffix] = np.asarray([labels.index(r['label']) for r in subset], dtype=np.int64)
            splits[split] = [r['id'] for r in subset]
        if len(arrays['X_train']):
            axes = (0, 1) if kind == 'sequence' else (0,)
            # Accumulate in float64: repeated visibility/presence constants must
            # not acquire a spurious variance from float32 summation drift.
            mean = arrays['X_train'].astype(np.float64).mean(axis=axes, keepdims=True)
            std = arrays['X_train'].astype(np.float64).std(axis=axes, keepdims=True)
            std[std < 1e-6] = 1
            for suffix in ('train', 'validation', 'test'):
                arrays['X_' + suffix] = ((arrays['X_' + suffix] - mean) / std).astype(np.float32)
            arrays.update(feature_mean=mean, feature_std=std)
            np.savez_compressed(output / name, **arrays)
        results[kind] = dict(labels=labels, sample_ids=splits,
            feature_shape=list(shape), scaler_fit='training only',
            feature_set='wrist-relative-palm-scaled-xyz128' if kind == 'static' else settings['temporal_feature_set'],
            artifact=name if len(arrays['X_train']) else None,
            evaluation_ready=all(splits.values()) and all(
                {r['label'] for r in usable if r['split'] == s} == set(labels) for s in splits))
    return results


def prepare(root, catalog_path, output, settings, factory=MediaPipeExtractor, fixture=False):
    if output.exists():
        raise ValueError('output exists; choose a new versioned directory')
    if output.resolve().is_relative_to((root / 'inputs').resolve()):
        raise ValueError('output must not be inside original inputs')
    catalog = read(catalog_path)
    validate_catalog(catalog)
    source_root = Path(catalog['source_root']) if catalog.get('source_root') else root
    if catalog.get('source_root') and output.resolve().is_relative_to(source_root.resolve()):
        raise ValueError('output must be separate from the external source dataset')
    settings = dict(DEFAULTS, **settings)
    if settings['temporal_feature_set'] not in ('geometry238', 'baseline164'):
        raise ValueError('temporal_feature_set must be geometry238 or baseline164')
    fractions = settings['split_fractions']
    if len(fractions) != 3 or any(not np.isfinite(f) or f <= 0 for f in fractions) or not np.isclose(sum(fractions), 1):
        raise ValueError('three positive split_fractions must sum to one')
    if not 0 <= settings['near_duplicate_hamming'] <= 64 or settings['min_dimension'] < 1:
        raise ValueError('invalid image validation thresholds')
    for key in ('min_valid_fraction', 'min_hand_fraction', 'min_pose_visibility'):
        if not 0 < settings[key] <= 1:
            raise ValueError('invalid quality threshold: ' + key)
    # Fail loudly on extractor setup errors instead of silently accepting missing detections.
    output.mkdir(parents=True)
    pool = None
    rows = []
    try:
        if factory is MediaPipeExtractor and catalog['samples']:
            pool = ImageExtractorPool(settings)
        def run_factory(config, video=False):
            return pool if pool is not None and not video else factory(config, video)
        total = len(catalog['samples'])
        with (output/'extraction-checkpoint.jsonl').open('w', encoding='utf-8') as checkpoint:
            for index, sample in enumerate(catalog['samples'], 1):
                row = process_sample(sample, source_root, settings, run_factory if pool else factory)
                rows.append(row)
                checkpoint.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
                if index % 100 == 0 or index == total:
                    checkpoint.flush()
                    write(output/'progress.json', dict(stage='extraction', completed=index, total=total, label=sample['label']))
                    print(f'Extracted {index}/{total} ({sample["label"]})', flush=True)
    finally:
        if pool:
            pool.finish()
    write(output/'progress.json', dict(stage='duplicate review and grouping', completed=len(rows), total=len(rows)))
    group_and_split(rows, settings)  # Detect duplicates before inclusion review.
    decide(rows)
    group_and_split(rows, settings, detect_duplicates=False)
    for row in rows:
        if row['extracted_frames']:
            path = output / ('static_samples' if row['kind'] == 'static' else 'sequence_landmarks') / slug(row['label']) / (row['id'] + '.json')
            write(path, dict(fixture=fixture, sample=row))
            row['landmarks_path'] = path.relative_to(output).as_posix()
        if row['kind'] == 'sequence' and row['technically_valid']:
            frames = [{k: f[k] for k in ('timestamp', 'raw', 'features', 'valid')} for f in row['extracted_frames']]
            metadata = dict(signerId=row.get('signer_id'), recordingSession=row.get('session_id'),
                sourceRecording=row.get('recording_id'), imageImportId=row['id'])
            sequence = dict(id=row['id'], label=row['label'], frameCount=len(frames), frames=frames, metadata=metadata)
            destination = 'compatible_samples' if row['included'] else 'review_samples'
            write(output / destination / row['label'] / (row['id'] + '.json'), dict(schemaVersion=1,
                featureSchema=SCHEMA, labels=[row['label']], sequenceCount=1, sequences=[sequence],
                imageImport=dict(fixture=fixture, provenance={k: v for k, v in row.items() if k != 'extracted_frames'})))
    tensor_info = save_tensors(rows, output, settings)
    per_sign = {}
    for label in sorted({r['label'] for r in rows}):
        subset = [r for r in rows if r['label'] == label]
        per_sign[label] = dict(total=len(subset), static=sum(r['kind']=='static' for r in subset),
            sequences=sum(r['kind']=='sequence' for r in subset), technically_valid=sum(r['technically_valid'] for r in subset),
            included=sum(r['included'] for r in subset), warnings=sum(bool(r['warnings']) for r in subset),
            excluded_or_pending=sum(not r['included'] for r in subset))
    report = dict(version=1, fixture=fixture, total_samples=len(rows), per_sign=per_sign,
        included=sum(r['included'] for r in rows), technically_valid=sum(r['technically_valid'] for r in rows),
        warnings=dict(Counter(w.split(':')[0] for r in rows for w in set(r['warnings']))),
        exclusion_and_review_reasons=dict(Counter(w for r in rows for w in r['inclusion_reasons'])),
        detected_hand_usage=dict(sum((Counter(r.get('quality', {}).get('hand_usage', {})) for r in rows), Counter())),
        missing_metadata=dict(Counter(w[8:] for r in rows for w in r['warnings'] if w.startswith('missing_'))),
        source_root=str(source_root.resolve()),
        unindexed_files=catalog.get('unindexed_files', []),
        unindexed_reasons=catalog.get('unindexed_reasons', {}), tensors=tensor_info,
        limitations=['Technical validity is not verified sign correctness.',
            'Source grouping alone does not establish performance on unseen people.',
            'Small group counts can leave evaluation splits empty or labels absent; inspect evaluation_ready.',
            'Visual duplicate hashing and wrist jumps are review heuristics, not semantic guarantees.',
            'Mirroring probe preserves source pixels and MediaPipe categories; it cannot establish anatomical identity.',
            'Temporal linear interpolation can blur presence flags and missing landmarks, matching the baseline; review gaps.',
            'No training was started.'])
    write(output / 'report.json', report)
    write(output / 'settings.json', settings)
    write(output / 'catalog.snapshot.json', catalog)
    with (output / 'manifest.jsonl').open('w', encoding='utf-8') as handle:
        for r in rows:
            handle.write(json.dumps({k:v for k,v in r.items() if k != 'extracted_frames'}, ensure_ascii=False, allow_nan=False) + '\n')
    source_dir = output / 'preparation_source'
    source_dir.mkdir()
    for name in ('prepare_image_dataset.py', 'image_landmarks.py', 'preprocess_dataset.py', 'processed_paths.py',
                 'prepare_handshape_experiments.py', 'gesture_geometry.py'):
        shutil.copy2(Path(__file__).with_name(name), source_dir / name)
    environment = dict(python=platform.python_version(), fixture=fixture,
        packages={name: version(name) for name in ('numpy', 'Pillow')}, models={})
    if factory is MediaPipeExtractor and rows:
        environment['packages']['mediapipe'] = version('mediapipe')
        environment['models'] = {key: dict(path=str(Path(settings[key]).resolve()), sha256=digest(Path(settings[key]).read_bytes())) for key in ('hand_model', 'pose_model')}
    environment['extractor'] = dict(backend='fixture' if fixture else 'MediaPipe Tasks CPU',
        hand_settings=dict(num_hands=2, detection=.5, presence=.4, tracking=.4),
        pose_settings=dict(num_poses=1, detection=.5, presence=.5, tracking=.5),
        mode='VIDEO trackers reset per timed sequence; shared stateless IMAGE model otherwise; exact decoded-input inference cache',
        orientation='EXIF transpose in memory', mirroring='source unchanged; independent flipped IMAGE probe')
    write(output / 'environment.json', environment)
    write(output/'progress.json', dict(stage='complete', completed=len(rows), total=len(rows)))
    write(output / 'artifact_checksums.json', {p.relative_to(output).as_posix(): digest(p.read_bytes())
        for p in sorted(output.rglob('*')) if p.is_file()})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    models = commands.add_parser('models', help='Provision local Hand and Pose Lite task assets')
    models.add_argument('--from-directory', type=Path, help='Copy existing hand.task and pose.task instead of downloading')
    index = commands.add_parser('index')
    index.add_argument('--catalog', type=Path)
    index.add_argument('--source', type=Path, help='Read-only external image dataset folder; originals stay here')
    index.add_argument('--layout', choices=['mixed', 'static', 'sequences'], default='mixed',
                       help='mixed: static/SIGN and sequences/SIGN/sample; static: SIGN/images; sequences: SIGN/sample/frames')
    run = commands.add_parser('prepare')
    run.add_argument('--catalog', type=Path)
    run.add_argument('--output', type=Path, required=True)
    run.add_argument('--settings', type=Path)
    args = parser.parse_args()
    if args.command == 'init':
        for folder in ('inputs/static', 'inputs/sequences', 'prepared'):
            (args.root / folder).mkdir(parents=True, exist_ok=True)
        if not (args.root / 'settings.json').exists():
            write(args.root / 'settings.json', dict(DEFAULTS,
                hand_model=str((args.root/'extractor/hand.task').resolve()),
                pose_model=str((args.root/'extractor/pose.task').resolve())))
        print(args.root)
    elif args.command == 'models':
        from urllib.request import urlretrieve
        settings_path = args.root/'settings.json'
        settings = read(settings_path)
        for name, model in [('hand', 'hand_landmarker/hand_landmarker'), ('pose', 'pose_landmarker/pose_landmarker_lite')]:
            destination = args.root/'extractor'/f'{name}.task'
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                if args.from_directory:
                    shutil.copy2(args.from_directory/f'{name}.task', destination)
                else:
                    url = f'https://storage.googleapis.com/mediapipe-models/{model}/float16/1/{model.split("/")[-1]}.task'
                    temporary = destination.with_suffix('.download')
                    urlretrieve(url, temporary)
                    temporary.replace(destination)
            settings[name+'_model'] = str(destination.resolve())
        write(settings_path, settings)
        print(settings_path)
    elif args.command == 'index':
        path = args.catalog or args.root / 'catalog.json'
        if path.exists():
            parser.error('catalog exists; use --catalog with a new filename and merge new entries without changing IDs')
        if args.source and not args.source.is_dir():
            parser.error('--source must be an existing directory')
        write(path, scan(args.root, args.source, args.layout))
        print(path)
    else:
        report = prepare(args.root, args.catalog or args.root / 'catalog.json', args.output,
            read(args.settings or args.root / 'settings.json'))
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
