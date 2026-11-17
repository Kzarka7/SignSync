"""Compare original sign labels with experimental English captions offline."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from caption_logic import Rules, text_value


SANDBOX = Path(__file__).resolve().parent
LAB_V2 = ('lab-signs43-similarity-v2', 'lab-signs43-similarity-v2-seed42-graph-diagnostics')


def load_json(path):
    payload = path.read_bytes()
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError(f'Expected a JSON object in {path}')
    return data, sha256(payload).hexdigest()


def fixtures(data, rules):
    entries = data.get('cases')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Fixtures need a nonempty cases list')
    results = []
    ids = set()
    for entry in entries:
        if not isinstance(entry, dict) or not text_value(entry.get('id')) or entry['id'] in ids:
            raise ValueError('Fixture cases need unique, nonempty ids')
        ids.add(entry['id'])
        cues = entry.get('cues', [])
        result = rules.translate_events(entry['events'], cues) if 'events' in entry else rules.translate(entry['labels'], cues)
        case = {'id': entry['id'], **result}
        if 'expected' in entry:
            expected = entry['expected']
            if not isinstance(expected, dict) or not expected or expected.keys() - {'status', 'caption', 'reason'}:
                raise ValueError(f"Expected status, caption or reason for fixture {entry['id']}")
            case['expected'] = expected
            case['passed'] = all(result[key] == value for key, value in expected.items())
        results.append(case)
    return results


def replay(data, baseline, rules):
    if (data.get('format') != 'signsync-fsl-sandbox-baseline-v1'
            or data.get('inputKind') != 'presegmented-validation-clips'):
        raise ValueError('Use a JSON report written by run_baseline.py')
    if any(data['baseline'].get(key) != value for key, value in baseline.items()):
        raise ValueError('Replay report differs from the pinned baseline')
    results = []
    for case in data['cases']:
        expected_labels = [clip['expectedLabel'] for clip in case['clips']]
        evidence = []
        for clip in case['clips']:
            prediction = clip['prediction']
            if prediction['model'] != baseline['modelId'] or type(prediction['accepted']) is not bool:
                raise ValueError(f"Invalid baseline prediction in case {case['id']}")
            evidence.append({'sampleId': clip['sampleId'], 'expectedLabel': clip['expectedLabel'],
                             'label': prediction['label'], 'score': prediction['score'], 'accepted': prediction['accepted']})
        recognized = [clip['label'] if clip['accepted'] else None for clip in evidence]
        results.append({'id': case['id'], **rules.translate(recognized), 'recognition': evidence,
                        'recognitionMatchesExpected': recognized == expected_labels,
                        'expectedLabelsOnly': rules.translate(expected_labels)})
    return results


def lab_export(data, baseline, rules):
    if data.get('format') != 'signsync-continuous-diagnostics' or data.get('version') != 1:
        raise ValueError('Use a JSON export from Recognition Lab')
    backend = data.get('backend') or {}
    identity = (data.get('modelMode'), backend.get('recognizerId'))
    if identity not in ((baseline['mode'], baseline['modelId']), LAB_V2):
        raise ValueError('Export must use the 43 Similar Signs v1 or v2 model')
    transcript = data['transcript']
    if not isinstance(transcript, list) or not all(isinstance(event, dict) and text_value(event.get('label'))
                                                   for event in transcript):
        raise ValueError('Expected accepted recognition events in the export transcript')
    return [{'id': 'lab-utterance', **rules.translate_events(transcript),
             'recognizerId': backend['recognizerId'],
             'recognition': transcript}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--labels', nargs='+', help='One utterance in signed order. Use ? for an uncertain sign.')
    inputs.add_argument('--fixtures', type=Path, help='JSON cases and optional expected results')
    inputs.add_argument('--baseline-report', type=Path, help='JSON from the offline baseline replay')
    inputs.add_argument('--lab-export', type=Path, help='Recognition Lab export containing one utterance')
    rule_options = parser.add_mutually_exclusive_group()
    rule_options.add_argument('--demo', action='store_true', help='Enable illustrative compound and syntax rules')
    rule_options.add_argument('--v2', action='store_true', help='Enable the experimental v2 caption rules')
    rule_options.add_argument('--rules', type=Path, help='Load your own experimental rule file')
    args = parser.parse_args()

    baseline, _ = load_json(SANDBOX / 'baseline.json')
    rules_file = SANDBOX / 'demo_rules.json' if args.demo or args.v2 else args.rules
    rules_data, rules_hash = load_json(rules_file) if rules_file else ({}, None)
    rules = Rules.load(set(baseline['labels']), rules_data, experimental=args.v2)
    _, template_hash = load_json(SANDBOX / 'experimental_template.json') if args.v2 else (None, None)

    if args.labels is not None:
        kind, source_hash = 'typed-labels', None
        results = [{'id': 'typed-utterance', **rules.translate([None if label == '?' else label for label in args.labels])}]
    else:
        path = args.fixtures or args.baseline_report or args.lab_export
        data, source_hash = load_json(path)
        if args.fixtures:
            kind, results = 'fixtures', fixtures(data, rules)
        elif args.baseline_report:
            kind, results = 'presegmented-replay', replay(data, baseline, rules)
        else:
            kind, results = 'lab-accepted-transcript', lab_export(data, baseline, rules)

    checked = [case for case in results if 'passed' in case]
    failed = sum(not case['passed'] for case in checked)
    report = {
        'format': 'signsync-fsl-sandbox-captions-v1', 'language': 'en', 'inputKind': kind,
        'inputSha256': source_hash, 'baseline': baseline,
        'ruleSet': 'illustrative-v2' if args.v2 else 'illustrative-demo' if args.demo else 'custom' if args.rules else 'display-only',
        **({'templateSha256': template_hash} if args.v2 else {}),
        'rulesSha256': rules_hash, 'cases': results,
        'summary': {'cases': len(results), 'expectationsChecked': len(checked), 'expectationsFailed': failed},
    }
    output = SANDBOX / 'runs' / ('captions-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    encoded = json.dumps(report, indent=2, allow_nan=False)
    output.parent.mkdir(exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(encoded + '\n')

    for case in results:
        outcome = case['caption'] or f"[fallback: {case['reason']}]"
        check = (' PASS' if case['passed'] else ' FAIL') if 'passed' in case else ''
        print(f"{case['id']}{check} | {case['raw'] or '[no signs]'} -> {outcome}")
    if checked:
        print(f'{len(checked) - failed}/{len(checked)} expectations passed')
    print(f'Report: {output}')
    return bool(failed)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise SystemExit(f'Caption test failed: {error}') from error
