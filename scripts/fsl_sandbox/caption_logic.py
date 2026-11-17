"""Apply a small English caption ruleset to one bounded sequence at a time."""

from dataclasses import dataclass
import json
from pathlib import Path


DISPLAY = json.loads(Path(__file__).with_name('display_rules.json').read_bytes())
EXPERIMENTAL_TEMPLATE = Path(__file__).with_name('experimental_template.json')


def text_value(value):
    return isinstance(value, str) and bool(value.strip())


def known_tokens(values, allowed, minimum):
    return isinstance(values, list) and len(values) >= minimum and all(
        text_value(value) and value in allowed for value in values
    )


def initial_capital(text):
    return text[:1].upper() + text[1:]


@dataclass(frozen=True)
class Rules:
    vocabulary: frozenset[str]
    display: dict
    compounds: dict
    syntax: dict
    template: dict | None = None

    @classmethod
    def load(cls, vocabulary, data, *, experimental=False):
        if not isinstance(data, dict) or data.keys() - {'display', 'compounds', 'syntax'}:
            raise ValueError('Rules must be an object with display, compounds or syntax')
        display = data.get('display', {})
        if not isinstance(display, dict) or not all(
            label in vocabulary and text_value(text) for label, text in display.items()
        ):
            raise ValueError('Display rules map baseline labels to nonempty text')

        compounds = {}
        syntax = {}
        used_ids = set()
        compound_tokens = set()
        for kind in ('compounds', 'syntax'):
            entries = data.get(kind, [])
            if not isinstance(entries, list):
                raise ValueError(f'{kind} rules must be a list')
            for entry in entries:
                if not isinstance(entry, dict) or not text_value(entry.get('id')) or entry['id'] in used_ids:
                    raise ValueError('Rules need unique, nonempty ids')
                rule_id = entry['id']
                used_ids.add(rule_id)
                cues = entry.get('requiresCues', [])
                if not isinstance(cues, list) or not all(text_value(cue) for cue in cues):
                    raise ValueError(f'Required cues must be a list of annotation names: {rule_id}')
                if kind == 'compounds':
                    labels, token, text = (entry.get(key) for key in ('labels', 'token', 'text'))
                    if (entry.keys() - {'id', 'labels', 'token', 'text', 'requiresCues'}
                            or not known_tokens(labels, vocabulary, 2)
                            or not text_value(token) or token in vocabulary or not text_value(text)):
                        raise ValueError(f'Invalid compound rule: {rule_id}')
                    if tuple(labels) in compounds:
                        raise ValueError(f'Duplicate compound input: {rule_id}')
                    compounds[tuple(labels)] = entry
                    compound_tokens.add(token)
                else:
                    tokens, order = entry.get('tokens'), entry.get('order')
                    if (entry.keys() - {'id', 'tokens', 'order', 'forms', 'requiresCues'}
                            or not known_tokens(tokens, vocabulary | compound_tokens, 2)
                            or not isinstance(order, list) or not all(type(index) is int for index in order)
                            or sorted(order) != list(range(len(tokens)))):
                        raise ValueError(f'Syntax rule needs known tokens and a complete output order: {rule_id}')
                    forms = entry.get('forms', [None] * len(tokens))
                    if (not isinstance(forms, list) or len(forms) != len(tokens)
                            or not all(form is None or text_value(form) for form in forms)):
                        raise ValueError(f'Syntax forms must align with input tokens: {rule_id}')
                    if tuple(tokens) in syntax:
                        raise ValueError(f'Duplicate syntax input: {rule_id}')
                    syntax[tuple(tokens)] = {**entry, 'forms': forms}
        template = json.loads(EXPERIMENTAL_TEMPLATE.read_bytes()) if experimental else None
        return cls(frozenset(vocabulary), DISPLAY | display, compounds, syntax, template)

    def translate_events(self, events, cues=()):
        labels = [event['label'] for event in events]
        if not self.template:
            return self.translate(labels, cues)

        kept = []
        seen = set()
        for index, event in enumerate(events):
            request_id = event.get('requestId')
            key = (request_id, event['label'])
            if isinstance(request_id, str) and request_id:
                if key in seen:
                    continue
                seen.add(key)
            kept.append(index)
        result = self.translate([labels[index] for index in kept], cues)
        for unit in result['lexicalUnits']:
            unit['inputIndices'] = [kept[index] for index in unit['inputIndices']]
        return {**result, 'inputLabels': labels, 'retainedInputIndices': kept,
                'raw': ' | '.join(label if label is not None else '[uncertain]' for label in labels)}

    def lexicalize(self, labels, cues):
        matches = {}
        previous_end = 0
        for start in range(len(labels)):
            for pattern, rule in self.compounds.items():
                end = start + len(pattern)
                if labels[start:end] == pattern:
                    if not cues.issuperset(rule.get('requiresCues', [])):
                        return [], 'missing-compound-cue'
                    if start < previous_end:
                        return [], 'overlapping-compounds'
                    matches[start] = (end, rule)
                    previous_end = end

        units = []
        index = 0
        while index < len(labels):
            if index in matches:
                end, rule = matches[index]
                units.append({'token': rule['token'], 'text': rule['text'], 'inputIndices': list(range(index, end)),
                              'ruleId': rule['id']})
                index = end
            else:
                label = labels[index]
                units.append({'token': label, 'text': self.display.get(label, label.lower().replace('_', ' ')),
                              'inputIndices': [index], 'ruleId': f'display:{label}' if label in self.display else None})
                index += 1
        return units, None

    def translate(self, labels, cues=()):
        if not isinstance(labels, list) or not all(label is None or text_value(label) for label in labels):
            raise ValueError('Labels must be a list of sign labels or null for an uncertain sign')
        if not isinstance(cues, (list, tuple)) or not all(text_value(cue) for cue in cues):
            raise ValueError('Cues must be a list of manual annotation names')
        cues = frozenset(cues)
        labels = tuple(labels)
        raw = ' | '.join(label if label is not None else '[uncertain]' for label in labels)
        result = {'inputLabels': list(labels), 'inputCues': sorted(cues), 'raw': raw, 'status': 'fallback', 'caption': None,
                  'reason': None, 'lexicalUnits': [], 'syntaxRuleId': None, 'outputUnitOrder': None}
        if not labels or None in labels:
            return {**result, 'reason': 'uncertain-sign' if labels else 'no-signs'}
        if any(label not in self.vocabulary for label in labels):
            return {**result, 'reason': 'unknown-label'}
        if self.template:
            glosses = [self.display.get(label, label.lower().replace('_', ' ')) for label in labels]
            result['caption'] = initial_capital(' · '.join(glosses))
        units, reason = self.lexicalize(labels, cues)
        if reason:
            return {**result, 'reason': reason}
        result['lexicalUnits'] = units
        tokens = [unit['token'] for unit in units]
        rule = self.syntax.get(tuple(tokens))
        status = 'syntax'
        if rule is None and self.template:
            time_labels = self.template['tags']['TIME']
            tags = ['TIME' if token in time_labels else token for token in tokens]
            if tags == self.template['tokens']:
                rule = self.template
                status = 'template'
        if rule:
            if not cues.issuperset(rule.get('requiresCues', [])):
                return {**result, 'reason': 'missing-syntax-cue'}
            forms = [form if form is not None else unit['text'] for form, unit in zip(rule.get('forms', [None] * len(units)), units)]
            sentence = ' '.join(forms[index] for index in rule['order'])
            punctuation = '' if sentence.endswith(('.', '?', '!')) else '.'
            return {**result, 'status': status, 'caption': initial_capital(sentence) + punctuation,
                    'syntaxRuleId': rule['id'], 'outputUnitOrder': rule['order']}
        if len(units) == 1 and units[0]['ruleId']:
            status = 'lexical' if len(labels) == 1 else 'compound'
            return {**result, 'status': status, 'caption': initial_capital(units[0]['text'])}
        return {**result, 'reason': 'unmatched-utterance'}
