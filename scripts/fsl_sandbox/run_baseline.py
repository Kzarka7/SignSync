"""Replay fixed, presegmented sign cases with the SignSync 43 Similar Signs baseline."""

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
from pathlib import Path
import platform
import sys


SANDBOX = Path(__file__).resolve().parent
REPO = SANDBOX.parents[1]
sys.path.insert(0, str(REPO / 'Backend'))

from app.recognition import GraphP4DiagnosticRecognizer, SampleDiagnosticRecognizer, SignRequest
from model_paths import model_artifact_folder
from processed_paths import processed_artifact_path
from sample_pipeline import digest, load_sample, read_csv


def read_baseline(dataset_root):
    baseline = json.loads((SANDBOX / 'baseline.json').read_bytes())
    experiment = baseline['experiment']
    prepared = processed_artifact_path(dataset_root / 'processed', experiment)
    model = model_artifact_folder(dataset_root / 'models', experiment) / experiment
    metadata_bytes = (prepared / 'metadata.json').read_bytes()
    if digest(metadata_bytes) != baseline['preparedMetadataSha256']:
        raise ValueError('Prepared baseline metadata differs from baseline.json')
    for filename, checksum in baseline['modelFileSha256'].items():
        if digest((model / filename).read_bytes()) != checksum:
            raise ValueError(f'Baseline model artifact differs from baseline.json: {filename}')
    return baseline, prepared, json.loads(metadata_bytes)


def replay_cases(dataset_root, recognizer, rows, validation_ids, cases):
    results = []
    seen_cases = set()
    if not cases:
        raise ValueError('Provide at least one case')
    for case in cases:
        case_id = case['id']
        if not isinstance(case_id, str) or not case_id.strip() or case_id in seen_cases:
            raise ValueError(f'Missing or repeated case ID: {case_id!r}')
        seen_cases.add(case_id)
        if not isinstance(case['clips'], list) or not case['clips']:
            raise ValueError(f'Case {case_id} needs an ordered list of clip IDs')

        clips = []
        for clip_index, sample_id in enumerate(case['clips'], start=1):
            if sample_id not in validation_ids:
                raise ValueError(f'Case {case_id} references a clip outside the baseline validation split: {sample_id}')
            row = rows[sample_id]
            sample_path = (dataset_root / row['sample_path']).resolve()
            if not sample_path.is_relative_to(dataset_root / 'samples'):
                raise ValueError(f'Clip path is outside the sample folder: {sample_id}')
            export, sequence, checksum, _ = load_sample(sample_path, row['label'])
            if checksum != row['sha256'] or sequence['id'] != sample_id:
                raise ValueError(f'Clip differs from the frozen manifest: {sample_id}')
            request = SignRequest(requestId=f'{len(results) + 1}-{clip_index}',
                                  featureOrder=export['featureSchema']['order'], frames=sequence['frames'])
            prediction = recognizer.predict(request)
            clips.append({'sampleId': sample_id, 'sourceSha256': checksum,
                          'expectedLabel': row['label'], 'prediction': prediction})

        results.append({'id': case_id, 'clips': clips,
                        'acceptedLabels': [clip['prediction']['label'] for clip in clips if clip['prediction']['accepted']]})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, default=REPO.parent / 'SignSync Dataset')
    parser.add_argument('--cases', type=Path, default=SANDBOX / 'cases.json')
    args = parser.parse_args()

    dataset_root = args.dataset_root.resolve()
    baseline, prepared, metadata = read_baseline(dataset_root)
    fixture_bytes = args.cases.read_bytes()
    cases = json.loads(fixture_bytes)['cases']
    recognizer = GraphP4DiagnosticRecognizer(SampleDiagnosticRecognizer(dataset_root, baseline['mode']))
    if recognizer.model_id != baseline['modelId'] or recognizer.labels != baseline['labels']:
        raise ValueError('Loaded recognizer or label order differs from baseline.json')
    results = replay_cases(dataset_root, recognizer, read_csv(prepared / 'samples.csv'),
                           set(metadata['sequenceIds']['validation']), cases)
    clips = [clip for case in results for clip in case['clips']]
    correct = sum(clip['prediction']['accepted'] and clip['prediction']['label'] == clip['expectedLabel']
                  for clip in clips)
    report = {
        'format': 'signsync-fsl-sandbox-baseline-v1',
        'inputKind': 'presegmented-validation-clips',
        'baseline': {**baseline, 'confidenceThreshold': recognizer.confidence_threshold,
                     'marginThreshold': recognizer.margin_threshold},
        'runtime': {'python': platform.python_version(), 'tensorflow': version('tensorflow'), 'numpy': version('numpy')},
        'casesSha256': digest(fixture_bytes),
        'summary': {'caseCount': len(results), 'clipCount': len(clips), 'correctAndAccepted': correct},
        'cases': results,
    }
    output = SANDBOX / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    output.parent.mkdir(exist_ok=True)
    encoded = json.dumps(report, indent=2, allow_nan=False)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(encoded + '\n')
    print(f'{len(results)} cases, {correct}/{len(clips)} clips correct and accepted')
    print(f'Report: {output}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f'Baseline replay failed: {error}') from error
