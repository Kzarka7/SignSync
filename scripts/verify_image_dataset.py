"""Reproduce clearly labeled synthetic and optional real-extractor smoke reports."""
import argparse
from pathlib import Path
from PIL import Image
from prepare_image_dataset import DEFAULTS, prepare, scan, write
from test_prepare_image_dataset import make_fixture, FixtureExtractor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New directory; never overwrites')
    parser.add_argument('--real-extractor', action='store_true', help='Also test installed MediaPipe and local model assets')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    fixture = args.output/'SYNTHETIC_FIXTURE_ONLY'
    make_fixture(fixture)
    report = prepare(fixture, fixture/'catalog.json', args.output/'fixture-report', {}, FixtureExtractor, fixture=True)
    print('SYNTHETIC injected-landmark fixture:', report['total_samples'], 'samples;', report['included'], 'included')
    if args.real_extractor:
        source = args.output/'REAL_EXTRACTOR_NEGATIVE_FIXTURE'
        path = source/'static/NOT_A_SIGN/blank.png'
        path.parent.mkdir(parents=True)
        Image.new('RGB', (128,128), 'white').save(path)
        sequence = source/'sequences/NOT_A_SIGN/blank-sequence'
        sequence.mkdir(parents=True)
        Image.new('RGB', (128,128), 'white').save(sequence/'0.png')
        Image.new('RGB', (128,128), 'black').save(sequence/'1.png')
        catalog = scan(args.output, source)
        for s in catalog['samples']:
            s.update(source_dataset='NEGATIVE_BLANK_IMAGE_FIXTURE', mirrored=False)
            if s['kind'] == 'sequence':
                s['frames'] = [p.relative_to(source).as_posix() for p in sorted(sequence.glob('*.png'))]
                s['timestamps_ms'] = [0,80]
        write(args.output/'real-catalog.json', catalog)
        report = prepare(args.output, args.output/'real-catalog.json', args.output/'real-extractor-report', DEFAULTS)
        assert report['included'] == 0
        assert report['detected_hand_usage'].get('neither') == 3
        print('Real MediaPipe IMAGE/VIDEO negative fixtures: no hands; correctly excluded')
    print('Reports:', args.output.resolve())


if __name__ == '__main__':
    main()
