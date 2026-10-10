# Replacement recordings: full geometry v3

Saved v4 and retrained v5 models evaluated on identical v5 held-out samples. Each uses its own training-fitted normalization. Architecture, 238 feature definitions and seeds 42/43/44 are unchanged. STAY and WHEN were replaced for all three participants; all other signs remain identical. Retained recordings keep their original splits. This is development evaluation; manifest updates remain pending.

| Test participant | Seed | Old model accuracy | Retrained accuracy | Old loss | Retrained loss | Old macro F1 | Retrained macro F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| participant_03 | 42 | 87.00% | 88.25% | 0.5903 | 0.5040 | 0.8543 | 0.8614 |
| participant_03 | 43 | 92.25% | 92.75% | 0.5221 | 0.2815 | 0.9155 | 0.9201 |
| participant_03 | 44 | 85.50% | 85.75% | 0.6098 | 0.4788 | 0.8479 | 0.8512 |
| participant_02 | 42 | 85.75% | 91.25% | 0.4632 | 0.3402 | 0.8504 | 0.9072 |
| participant_02 | 43 | 90.00% | 90.75% | 0.4650 | 0.3235 | 0.8919 | 0.8984 |
| participant_02 | 44 | 89.50% | 92.25% | 0.6460 | 0.4469 | 0.8891 | 0.9207 |
| participant_01 | 42 | 85.25% | 85.00% | 0.4608 | 0.5805 | 0.8495 | 0.8441 |
| participant_01 | 43 | 91.00% | 92.75% | 0.3545 | 0.2059 | 0.9095 | 0.9255 |
| participant_01 | 44 | 88.25% | 86.00% | 0.5532 | 0.3828 | 0.8796 | 0.8526 |

## Means across seeds

| Participant | Runs | Old accuracy | Retrained accuracy | Old macro F1 | Retrained macro F1 |
|---|---:|---:|---:|---:|---:|
| participant_01 | 3 | 88.17% | 87.92% | 0.8795 | 0.8741 |
| participant_02 | 3 | 88.42% | 91.42% | 0.8771 | 0.9087 |
| participant_03 | 3 | 88.25% | 88.92% | 0.8726 | 0.8776 |
| ALL | 9 | 88.28% | 89.42% | 0.8764 | 0.8868 |

## Every sign, correct out of 20

| Participant | Seed | Sign | Old | Retrained | Change |
|---|---:|---|---:|---:|---:|
| participant_03 | 42 | FAMILY | 18 | 20 | +2 |
| participant_03 | 42 | FRIEND | 20 | 20 | +0 |
| participant_03 | 42 | HELLO | 20 | 20 | +0 |
| participant_03 | 42 | HELP | 20 | 18 | -2 |
| participant_03 | 42 | HOW | 20 | 20 | +0 |
| participant_03 | 42 | NO | 20 | 20 | +0 |
| participant_03 | 42 | PLEASE | 20 | 20 | +0 |
| participant_03 | 42 | SORRY | 20 | 20 | +0 |
| participant_03 | 42 | STAY | 18 | 20 | +2 |
| participant_03 | 42 | THANK_YOU | 11 | 6 | -5 |
| participant_03 | 42 | WAIT | 20 | 20 | +0 |
| participant_03 | 42 | WAVE_GREETING | 20 | 20 | +0 |
| participant_03 | 42 | WELCOME | 20 | 20 | +0 |
| participant_03 | 42 | WHAT | 11 | 20 | +9 |
| participant_03 | 42 | WHEN | 5 | 8 | +3 |
| participant_03 | 42 | WHERE | 20 | 19 | -1 |
| participant_03 | 42 | WHICH | 20 | 20 | +0 |
| participant_03 | 42 | WHO | 5 | 2 | -3 |
| participant_03 | 42 | WHY | 20 | 20 | +0 |
| participant_03 | 42 | YES | 20 | 20 | +0 |
| participant_03 | 43 | FAMILY | 19 | 20 | +1 |
| participant_03 | 43 | FRIEND | 20 | 18 | -2 |
| participant_03 | 43 | HELLO | 20 | 20 | +0 |
| participant_03 | 43 | HELP | 19 | 19 | +0 |
| participant_03 | 43 | HOW | 20 | 20 | +0 |
| participant_03 | 43 | NO | 20 | 20 | +0 |
| participant_03 | 43 | PLEASE | 19 | 19 | +0 |
| participant_03 | 43 | SORRY | 20 | 20 | +0 |
| participant_03 | 43 | STAY | 20 | 20 | +0 |
| participant_03 | 43 | THANK_YOU | 16 | 19 | +3 |
| participant_03 | 43 | WAIT | 20 | 20 | +0 |
| participant_03 | 43 | WAVE_GREETING | 20 | 20 | +0 |
| participant_03 | 43 | WELCOME | 20 | 20 | +0 |
| participant_03 | 43 | WHAT | 20 | 20 | +0 |
| participant_03 | 43 | WHEN | 6 | 6 | +0 |
| participant_03 | 43 | WHERE | 19 | 20 | +1 |
| participant_03 | 43 | WHICH | 20 | 20 | +0 |
| participant_03 | 43 | WHO | 11 | 11 | +0 |
| participant_03 | 43 | WHY | 20 | 19 | -1 |
| participant_03 | 43 | YES | 20 | 20 | +0 |
| participant_03 | 44 | FAMILY | 20 | 20 | +0 |
| participant_03 | 44 | FRIEND | 19 | 11 | -8 |
| participant_03 | 44 | HELLO | 18 | 20 | +2 |
| participant_03 | 44 | HELP | 15 | 10 | -5 |
| participant_03 | 44 | HOW | 20 | 20 | +0 |
| participant_03 | 44 | NO | 20 | 20 | +0 |
| participant_03 | 44 | PLEASE | 20 | 20 | +0 |
| participant_03 | 44 | SORRY | 20 | 20 | +0 |
| participant_03 | 44 | STAY | 14 | 20 | +6 |
| participant_03 | 44 | THANK_YOU | 13 | 11 | -2 |
| participant_03 | 44 | WAIT | 20 | 19 | -1 |
| participant_03 | 44 | WAVE_GREETING | 20 | 20 | +0 |
| participant_03 | 44 | WELCOME | 20 | 20 | +0 |
| participant_03 | 44 | WHAT | 9 | 14 | +5 |
| participant_03 | 44 | WHEN | 6 | 10 | +4 |
| participant_03 | 44 | WHERE | 19 | 19 | +0 |
| participant_03 | 44 | WHICH | 20 | 20 | +0 |
| participant_03 | 44 | WHO | 9 | 9 | +0 |
| participant_03 | 44 | WHY | 20 | 20 | +0 |
| participant_03 | 44 | YES | 20 | 20 | +0 |
| participant_02 | 42 | FAMILY | 20 | 20 | +0 |
| participant_02 | 42 | FRIEND | 20 | 20 | +0 |
| participant_02 | 42 | HELLO | 20 | 20 | +0 |
| participant_02 | 42 | HELP | 13 | 15 | +2 |
| participant_02 | 42 | HOW | 20 | 20 | +0 |
| participant_02 | 42 | NO | 20 | 20 | +0 |
| participant_02 | 42 | PLEASE | 18 | 20 | +2 |
| participant_02 | 42 | SORRY | 20 | 20 | +0 |
| participant_02 | 42 | STAY | 20 | 20 | +0 |
| participant_02 | 42 | THANK_YOU | 15 | 8 | -7 |
| participant_02 | 42 | WAIT | 10 | 15 | +5 |
| participant_02 | 42 | WAVE_GREETING | 20 | 20 | +0 |
| participant_02 | 42 | WELCOME | 18 | 20 | +2 |
| participant_02 | 42 | WHAT | 10 | 10 | +0 |
| participant_02 | 42 | WHEN | 10 | 20 | +10 |
| participant_02 | 42 | WHERE | 9 | 17 | +8 |
| participant_02 | 42 | WHICH | 20 | 20 | +0 |
| participant_02 | 42 | WHO | 20 | 20 | +0 |
| participant_02 | 42 | WHY | 20 | 20 | +0 |
| participant_02 | 42 | YES | 20 | 20 | +0 |
| participant_02 | 43 | FAMILY | 20 | 20 | +0 |
| participant_02 | 43 | FRIEND | 20 | 20 | +0 |
| participant_02 | 43 | HELLO | 10 | 8 | -2 |
| participant_02 | 43 | HELP | 14 | 16 | +2 |
| participant_02 | 43 | HOW | 20 | 20 | +0 |
| participant_02 | 43 | NO | 20 | 20 | +0 |
| participant_02 | 43 | PLEASE | 20 | 17 | -3 |
| participant_02 | 43 | SORRY | 20 | 20 | +0 |
| participant_02 | 43 | STAY | 20 | 20 | +0 |
| participant_02 | 43 | THANK_YOU | 9 | 8 | -1 |
| participant_02 | 43 | WAIT | 20 | 19 | -1 |
| participant_02 | 43 | WAVE_GREETING | 20 | 20 | +0 |
| participant_02 | 43 | WELCOME | 20 | 18 | -2 |
| participant_02 | 43 | WHAT | 17 | 18 | +1 |
| participant_02 | 43 | WHEN | 10 | 20 | +10 |
| participant_02 | 43 | WHERE | 20 | 19 | -1 |
| participant_02 | 43 | WHICH | 20 | 20 | +0 |
| participant_02 | 43 | WHO | 20 | 20 | +0 |
| participant_02 | 43 | WHY | 20 | 20 | +0 |
| participant_02 | 43 | YES | 20 | 20 | +0 |
| participant_02 | 44 | FAMILY | 20 | 20 | +0 |
| participant_02 | 44 | FRIEND | 20 | 20 | +0 |
| participant_02 | 44 | HELLO | 16 | 16 | +0 |
| participant_02 | 44 | HELP | 14 | 18 | +4 |
| participant_02 | 44 | HOW | 20 | 20 | +0 |
| participant_02 | 44 | NO | 20 | 20 | +0 |
| participant_02 | 44 | PLEASE | 20 | 20 | +0 |
| participant_02 | 44 | SORRY | 20 | 20 | +0 |
| participant_02 | 44 | STAY | 20 | 20 | +0 |
| participant_02 | 44 | THANK_YOU | 14 | 13 | -1 |
| participant_02 | 44 | WAIT | 18 | 18 | +0 |
| participant_02 | 44 | WAVE_GREETING | 20 | 20 | +0 |
| participant_02 | 44 | WELCOME | 18 | 19 | +1 |
| participant_02 | 44 | WHAT | 10 | 10 | +0 |
| participant_02 | 44 | WHEN | 8 | 19 | +11 |
| participant_02 | 44 | WHERE | 20 | 16 | -4 |
| participant_02 | 44 | WHICH | 20 | 20 | +0 |
| participant_02 | 44 | WHO | 20 | 20 | +0 |
| participant_02 | 44 | WHY | 20 | 20 | +0 |
| participant_02 | 44 | YES | 20 | 20 | +0 |
| participant_01 | 42 | FAMILY | 9 | 4 | -5 |
| participant_01 | 42 | FRIEND | 20 | 20 | +0 |
| participant_01 | 42 | HELLO | 19 | 19 | +0 |
| participant_01 | 42 | HELP | 16 | 7 | -9 |
| participant_01 | 42 | HOW | 17 | 15 | -2 |
| participant_01 | 42 | NO | 10 | 18 | +8 |
| participant_01 | 42 | PLEASE | 13 | 15 | +2 |
| participant_01 | 42 | SORRY | 20 | 20 | +0 |
| participant_01 | 42 | STAY | 20 | 20 | +0 |
| participant_01 | 42 | THANK_YOU | 20 | 19 | -1 |
| participant_01 | 42 | WAIT | 20 | 19 | -1 |
| participant_01 | 42 | WAVE_GREETING | 16 | 18 | +2 |
| participant_01 | 42 | WELCOME | 20 | 20 | +0 |
| participant_01 | 42 | WHAT | 20 | 20 | +0 |
| participant_01 | 42 | WHEN | 13 | 16 | +3 |
| participant_01 | 42 | WHERE | 20 | 20 | +0 |
| participant_01 | 42 | WHICH | 19 | 20 | +1 |
| participant_01 | 42 | WHO | 14 | 13 | -1 |
| participant_01 | 42 | WHY | 18 | 18 | +0 |
| participant_01 | 42 | YES | 17 | 19 | +2 |
| participant_01 | 43 | FAMILY | 20 | 20 | +0 |
| participant_01 | 43 | FRIEND | 20 | 20 | +0 |
| participant_01 | 43 | HELLO | 20 | 13 | -7 |
| participant_01 | 43 | HELP | 8 | 13 | +5 |
| participant_01 | 43 | HOW | 15 | 15 | +0 |
| participant_01 | 43 | NO | 20 | 20 | +0 |
| participant_01 | 43 | PLEASE | 20 | 20 | +0 |
| participant_01 | 43 | SORRY | 20 | 20 | +0 |
| participant_01 | 43 | STAY | 20 | 20 | +0 |
| participant_01 | 43 | THANK_YOU | 20 | 19 | -1 |
| participant_01 | 43 | WAIT | 20 | 19 | -1 |
| participant_01 | 43 | WAVE_GREETING | 20 | 20 | +0 |
| participant_01 | 43 | WELCOME | 18 | 19 | +1 |
| participant_01 | 43 | WHAT | 20 | 20 | +0 |
| participant_01 | 43 | WHEN | 11 | 20 | +9 |
| participant_01 | 43 | WHERE | 20 | 20 | +0 |
| participant_01 | 43 | WHICH | 15 | 16 | +1 |
| participant_01 | 43 | WHO | 20 | 19 | -1 |
| participant_01 | 43 | WHY | 18 | 19 | +1 |
| participant_01 | 43 | YES | 19 | 19 | +0 |
| participant_01 | 44 | FAMILY | 17 | 5 | -12 |
| participant_01 | 44 | FRIEND | 20 | 20 | +0 |
| participant_01 | 44 | HELLO | 19 | 19 | +0 |
| participant_01 | 44 | HELP | 19 | 10 | -9 |
| participant_01 | 44 | HOW | 18 | 17 | -1 |
| participant_01 | 44 | NO | 18 | 12 | -6 |
| participant_01 | 44 | PLEASE | 17 | 17 | +0 |
| participant_01 | 44 | SORRY | 20 | 20 | +0 |
| participant_01 | 44 | STAY | 20 | 20 | +0 |
| participant_01 | 44 | THANK_YOU | 20 | 20 | +0 |
| participant_01 | 44 | WAIT | 20 | 20 | +0 |
| participant_01 | 44 | WAVE_GREETING | 17 | 18 | +1 |
| participant_01 | 44 | WELCOME | 20 | 20 | +0 |
| participant_01 | 44 | WHAT | 20 | 16 | -4 |
| participant_01 | 44 | WHEN | 8 | 20 | +12 |
| participant_01 | 44 | WHERE | 20 | 20 | +0 |
| participant_01 | 44 | WHICH | 13 | 18 | +5 |
| participant_01 | 44 | WHO | 15 | 15 | +0 |
| participant_01 | 44 | WHY | 14 | 20 | +6 |
| participant_01 | 44 | YES | 18 | 17 | -1 |

Predictions: retained in the local SignSync Dataset; not included in this model backup.

Loss uses sklearn log_loss for both sides. Historical v4-model results are retained locally for context, but the paired comparison uses identical v5 test samples. Input reconstruction was checked against retained v4 test tensors before saved-model inference.
