# Test the FSL caption prototype

Use the standalone runner to test English captions from 43 Similar Signs labels. Start with typed labels, then replay the frozen baseline. Use Recognition Lab video or camera exports when you want to include real recognition in the check. All caption commands save a JSON report under [`runs/`](runs/) and print its path. Run the commands from the SignSync project root in PowerShell.

## 1. Try the caption logic with typed labels

These inputs go straight to the caption rules. Each `--labels` command supplies one complete utterance. The sandbox uses the existing `.venv-gru` Python environment. A running app and a camera are needed only for the Recognition Lab check.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --labels GOOD_MORNING
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --labels FAMILY FRIEND --demo
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --labels WAIT PLEASE --demo
```

| Input | What to check |
| --- | --- |
| `GOOD_MORNING` | One recognized label renders as “Good morning”. |
| `FAMILY FRIEND --demo` | The two adjacent labels match the demo compound rule. The report preserves both input labels. |
| `WAIT PLEASE --demo` | The exact two-label utterance produces “Please wait.” The raw order remains `WAIT`, `PLEASE`. |
| `WAIT PLEASE` | With demo rules disabled, the input stays in signed order. |
| `PLEASE WAIT --demo` | The reverse order shows `PLEASE \| WAIT` as a fallback. |
| `TODAY WAIT PLEASE --demo` | The full input produces “Please wait today.” |
| `WAIT WAIT --demo` | Both occurrences of `WAIT` remain visible. |
| `WAIT '?' PLEASE --demo` | The uncertain middle sign prevents the shorter rule from firing. |

The demo compound and syntax examples exercise the software. Their intended meaning in real signing still needs review by fluent Deaf FSL signers.

## 2. Replay a fixed set of model predictions

Run the recognition baseline, then pass the JSON path printed by that command to the caption runner. Use quotes around the path in PowerShell.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_baseline.py --cases .\scripts\fsl_sandbox\caption_clip_cases.json
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --baseline-report 'PATH_FROM_BASELINE_COMMAND' --demo
```

Open the caption report and compare `expectedLabelsOnly` with the caption from the model's actual predictions. Each case has its own boundary. The three demonstration cases should produce the same outputs shown in step 1. Inspect `recognition` if a label differs or a clip is rejected. These are presegmented validation clips. The case groupings supply test boundaries and lack FSL sentence annotations.

## 3. Make a regression fixture

Run the bundled checks first. The command prints `13/13 expectations passed` and exits with an error if an expectation fails.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --fixtures .\scripts\fsl_sandbox\caption_fixtures.json --demo
```

To add your own checks, save the following as `my-caption-cases.json` in the project root. Give each complete utterance its own case ID. An `expected` result is optional. Use it when you want the runner to check a specific status and caption.

```json
{
  "cases": [
    {
      "id": "demo-reorder",
      "labels": ["WAIT", "PLEASE"],
      "expected": {"status": "syntax", "caption": "Please wait."}
    },
    {"id": "first-utterance", "labels": ["WAIT"]},
    {"id": "second-utterance", "labels": ["PLEASE"]}
  ]
}
```

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --fixtures .\my-caption-cases.json --demo
```

Check that `demo-reorder` matches its expectation and that the two one-label cases stay independent. When you add a compound example, test the same components with reversed order, an intervening sign, and a boundary between the components. When you add a syntax example, test the full utterance, a partial sequence, and the same sequence with an extra label.

## 4. Try a single utterance from video or camera

1. If SignSync is already running locally, open **Recognition Lab** and select **43 Similar Signs (v1 baseline)**. To start it, use the [local setup](../../README.md#run-locally) and run these commands in separate PowerShell terminals from the project root. Open the URL printed by Vite.

   ```powershell
   .\.venv-gru\Scripts\python.exe -m uvicorn app.main:app --app-dir Backend --host 127.0.0.1 --port 8000
   ```

   ```powershell
   Set-Location .\Frontend
   npm run dev
   ```

2. Select **Video**, choose a short video with one signed utterance, and click **Start replay**. For a camera test, choose **Camera**, keep your hands and shoulders in view, and click **Start recognition**. Sign one utterance, then stop. Begin with a recognized label such as `GOOD_MORNING` before trying paired signs.
3. Watch **English caption preview** below **Confirmed signs**. Sign `WAIT` followed by `PLEASE` in a fresh run and check for “Please wait.” The preview uses the full sequence of confirmed signs in the current run, so start a new run for each utterance. The compound and syntax outputs use demo rules.

For an offline report, click **Export recognition results** and pass its path to the standalone runner. Use the `--demo` flag to match the Lab preview. The sandbox checks the recognizer ID and uses the accepted transcript. If the transcript missed a sign, use a fixture with a `null` gap to test that uncertainty explicitly.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --lab-export 'PATH_TO_RECOGNITION_EXPORT.json' --demo
```

If a sign is missing, extra, or wrong in the accepted transcript, inspect recognition and its boundaries first. Retest with the intended labels using `--labels`. If those labels produce a caption that changes the meaning, inspect the caption rules. A fallback for an unsupported sequence is an expected outcome. Model scores describe recognition evidence. A caption's meaning needs its own review.

### Compare v1 and v2 in Recognition Lab

1. Run a short video with **43 Similar Signs (v1 baseline)** and click **Pin baseline run** after it finishes. A completed camera run can also be pinned.
2. Change **Recognition model** to **43 Similar Signs (v2 experiment)** and replay the same loaded video. Use the same recognition settings and keep **Caption rules** on **v1 demo** for this comparison. Check the confirmed signs in both panels and use **Export recognition results** to save the run and its pinned baseline.
3. Change **Caption rules** to **v2 experiment** to try the new rules on the current run's transcript. When it contains exactly `TOMORROW → WAIT → PLEASE`, expect “Please wait tomorrow.” Both recognition models can feed either set of caption rules. The pinned run retains the caption setting it had at pin time.

To check the v2 caption template directly or replay a recent v1 or v2 Lab export, use `--v2` in place of `--demo`.

```powershell
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --labels TOMORROW WAIT PLEASE --v2
.\.venv-gru\Scripts\python.exe -B .\scripts\fsl_sandbox\run_captions.py --lab-export 'PATH_TO_RECOGNITION_EXPORT.json' --v2
```

## 5. Prepare real examples for review

Ask a fluent Deaf FSL signer to review a complete utterance and its intended English caption. Record the clip ID, sign order, utterance boundary, acceptable English captions, and any context or nonmanual cue that affects interpretation. For a compound, record a counterexample where similar signs keep their separate meanings. For a syntax pattern, check that the caption preserves who did what, time, negation, and question intent wherever those are present. Start with the manually checked labels, then try the matching recording. Keep reports from both checks with the notes so a caption error can be traced back to the input that produced it.
