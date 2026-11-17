# FSL test sandbox

Use the [FSL caption testing guide](TESTING.md) to try lexicalization and syntax with typed labels, saved model predictions, or a Recognition Lab export. The caption runner works offline and uses English for the prototype.

To run **43 Similar Signs** offline against fixed landmark clips, use the existing local `.venv-gru` from the project root in PowerShell. The baseline runner reads the model and samples from the sibling `SignSync Dataset` folder.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_baseline.py
```

The runner checks the seed-42 `samples_43_signs_similarity_v1` checkpoint, prepared metadata and threshold files against [baseline.json](baseline.json). It uses the same graph recognizer as Recognition Lab, including the frozen label order and training scaler. Pass `--dataset-root "C:\path\to\SignSync Dataset"` if the vault is elsewhere.

## Inputs and reports

- [cases.json](cases.json) groups ten fixed validation clips into four cases covering multiword labels, similar signs, a repeated label and input order. Each clip supplies an existing sign boundary. The groups are fixtures for testing order and case boundaries, with no FSL sentence annotations.
- For another controlled run, copy `cases.json`, set distinct case IDs and use ordered clip IDs from `sequenceIds.validation` in the baseline's prepared `metadata.json`. Pass `--cases PATH` to replay that copy.
- Each successful run writes a fresh JSON report under `runs/`. It records the baseline and fixture hashes, all 43 labels, recognition settings and runtime versions. The cases include expected labels, predictions and scores, and the accepted labels in order. Compare accepted labels and scores across runs. Inference timings naturally vary.

The baseline replay measures recognition on presegmented clips. The smoke result applies to these fixtures. Continuous recognition and caption quality require separate review on complete signed utterances.

## Try a custom caption rule

Copy [demo_rules.json](demo_rules.json) as a starting point. Run `run_captions.py --rules PATH` with typed labels, fixtures, a baseline report, or a Lab export. A custom file supplements the built-in single-label display mappings and is an alternative to `--demo`.

- `display` maps a baseline label to its English wording. For example, `{"GOOD_MORNING": "good morning"}` renders one model label as a multiword caption.
- Each `compounds` entry has an `id`, two or more adjacent baseline `labels` in observed order, a new lexical `token`, and its English `text`. Matching groups only within one utterance. If two matches overlap, the runner shows the original labels as a fallback.
- Each `syntax` entry has an `id`, the exact sequence of lexical `tokens` for the entire utterance, and an `order` listing their zero-based indices in caption order. Optional `forms` gives each token's wording in input order. Use `null` for a token that keeps its lexical wording. The order must include every index once. Use a separate fixture for every allowed input order.
- A compound or syntax rule can list `requiresCues` such as `["question-marker"]`. To exercise it, add `"cues": ["question-marker"]` to the matching case in your fixture JSON. This simulates a review annotation. Typed labels, baseline reports and Lab exports supply no manual cue annotations and fall back when a matching rule requires one.

Review every candidate compound and syntax pattern against complete signed examples before treating its output as a validated caption. Record context, relevant non-manual cues and regional variants with a fluent Deaf FSL signer. [Benilde CEAD vocabulary and phrase documentation](https://sdgs.benilde.edu.ph/field-documentation-of-filipino-sign-language-vocabulary-and-phrases/) · [FSL non-manual signal research](https://www.sign-lang.uni-hamburg.de/lrec/pub/18040.html)
