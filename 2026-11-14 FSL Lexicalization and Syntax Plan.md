# 2026-11-14 FSL Lexicalization and Syntax Plan

Planning discussion completed on 2026-11-14. Implementation and signer review are pending.

## User request

> i'm planning to plan and prepare for the logic update of the sign language. The system should handle the Visual Shortcuts & Compound Signs (Lexicalization) and Sequence Reordering & Syntax Shifting. Tell me your plan and which should we do first. Record this chat and saved it once we're done.

## Recommendation

Start with **lexicalization**, then add **sequence reordering and syntax shifting**. Establish what each recognized sign or reviewed group of signs means before deciding how to express those meanings as a sentence. Start collecting examples of complete utterances during the lexicalization pilot.

The first direction proposed here is **FSL signing to written captions** in Live Conversation. Examples use English for illustration. Confirm the caption language before writing syntax rules, since English and Filipino need different rules.

## Where the change fits

- [Live Conversation](Frontend/src/pages/LiveConversationPage.tsx) receives confirmed events from [continuous recognition](Frontend/src/hooks/useContinuousLiveRecognition.ts). [The translation stream](Frontend/src/hooks/useTranslationStream.ts) replaces underscores with spaces and creates one conversation message per confirmed sign. The proposed logic belongs between that callback and conversation-message creation.
- The [live model selector](Frontend/src/services/landmarks/liveRecognitionPolicy.ts) and [Recognition Lab](Frontend/src/pages/RecognitionLabPage.tsx) currently use `lab-signs43-similarity` as their Signs default. See the [baseline audit](../SignSync%20Dataset/documentation/2026-11-14%20Recognition%20Lab%20Baseline%20Audit.md) for the lab checkpoint and split. Its saved scores describe isolated clips. End-to-end utterance accuracy still needs measurement.
- Confirmed entries currently provide the label, model score, request ID and decision time. Preserve that evidence and the original signed order. Add sign timing or segment identifiers where available if a rule needs them. Keep recognition scores and translation review findings distinct.

## Phase 1 · Lexicalization

1. Pick three to five entries for a first pass with fluent Deaf FSL signers. For each entry, record the recognized label or attested sign sequence, intended meaning, caption, relevant variants and a counterexample. Use the regional vocabulary and phrase documentation from [Benilde CEAD](https://sdgs.benilde.edu.ph/field-documentation-of-filipino-sign-language-vocabulary-and-phrases/) as a reference.
2. Begin with single-label mappings. The current vocabulary includes `GOOD_MORNING` and `THANK_YOU`. Rendering `GOOD_MORNING` as “Good morning” tests a multiword caption from one recognized label. The label name by itself gives no evidence of the sign's linguistic structure.
3. Add sequence matching for compounds only where FSL review confirms the combined meaning and the recognizer reliably emits the component signs. Scope matches to one utterance and check a reviewed example where the same or similar signs carry separate meanings. Keep the original labels when a match is ambiguous or incomplete. For a visually distinct fused sign that the model cannot recognize reliably, collect reviewed recordings and evaluate a recognition candidate using the [sample training workflow](scripts/SAMPLE_TRAINING.md).
4. Prototype with the accepted-sign stream in Recognition Lab or offline replay. Keep the recognized sequence visible beside the proposed caption so a reviewer can trace each transformation back to the input.

## Phase 2 · Sequence reordering and syntax shifting

1. Collect a small set of complete utterances using the supported vocabulary. Record the signed order, sign and utterance boundaries, intended meaning and acceptable captions in the chosen language. Ask signers to flag where facial expression, head movement or signing space changes the interpretation. The current camera path uses [hand and pose tracking](Frontend/src/services/landmarks/visionRuntime.ts). There is no dedicated facial-expression recognizer in that path. FSL research documents the role of non-manual signals in distinguishing sentence types. [Rivera and Ong, 2018](https://www.sign-lang.uni-hamburg.de/lrec/pub/18040.html)
2. Start with one reviewed clause pattern that the model vocabulary can support, such as a simple time-marked statement if the annotated examples support it. Buffer the confirmed signs and use an explicit Send action in the first pilot to mark the end of an utterance. Consider automatic boundaries once replay shows where pauses split sentences or join separate turns.
3. Apply the syntax rule to the meanings produced by phase 1. Preserve time, negation, participants and question intent wherever the source establishes them. Show the recognized sequence as a fallback when a required cue is absent, recognition is uncertain, or the pattern is outside the reviewed set. Avoid applying a single word-order rule to all FSL utterances.

## Verification before live use

- Test with human-annotated sign sequences first to check lexical mappings and sentence meaning independently of camera recognition. Include variants, literal versus compound readings, repeated signs, missing signs, uncertain inputs and two adjacent utterances. Review meaning preservation and fallback behavior with Deaf FSL signers.
- Replay held-out continuous recordings, keeping signers and source recordings apart from development wherever the data allows. Measure missed, wrong and extra signs, boundary errors, false compound matches, caption meaning preservation, fallback frequency and latency. Compare with the current label-only transcript and report fixture and camera results separately.
- Before enabling Live Conversation, verify each utterance commits once, pending recognition cannot add late text, and captions and original sign events can be traced in session history and exports. Exercise stop, mode changes, speech and quick phrases, and session end in the integrated flow.

## Discussion outcome

The first implementation milestone proposed is a small signer-reviewed lexicon and replay fixture set that turns accepted sign events into traceable captions. This session checked the source handoff, current model selection and label coverage, both vault guides and the FSL references. No implementation, model changes, camera evaluation or signer validation took place. This note is the saved discussion record linked from [Project Home](Project%20Home.md), [Dataset Guide](../SignSync%20Dataset/Dataset%20Guide.md) and both vaults’ conversation logs.

## Controlled environment · 2026-11-14

The user requested a standalone test environment based on **43 Similar Signs**, with integration deferred. Set up an offline runner that reads the seed-42 checkpoint and matching preparation from the dataset vault and writes reports locally. Use fixed validation clips for repeatable input and preserve their order and case boundaries in the output. Verify the artifact identity, actual inference, and repeatability before handing it off. This step prepares only the environment.

### Setup and verification

- Created the [FSL test sandbox](scripts/fsl_sandbox/README.md). It uses the existing GRU Python environment and graph recognizer in a standalone process. The runner verifies the baseline artifact and sample hashes and writes a new local report for each run. The app and model files were outside the scope of this setup.
- The [fixture set](scripts/fsl_sandbox/cases.json) uses ten frozen validation clips across four cases. These clips supply explicit sign boundaries. Their grouping exercises input order and repeated signs without asserting FSL sentence meanings.
- The [first report](scripts/fsl_sandbox/runs/20261114T063619276739Z.json) and [repeat report](scripts/fsl_sandbox/runs/20261114T063638302293Z.json) each show 10 of 10 clips correctly recognized and accepted. The reports matched after excluding inference timing. Confirmed 43 labels, threshold `0.54`, input order and case boundaries. The result applies to the smoke fixtures.
- Next, add reviewed lexical examples and corresponding expected meanings when the logic work begins. Continuous testing and app integration are pending.

## Lexicalization and syntax prototype · 2026-11-14

The user asked to proceed with the logic and provide complete testing instructions. Use the existing offline sandbox and pinned 43 Similar Signs baseline. Prototype English captions, retain the input order in the report, and use explicitly delimited utterances. Verify single-label display mappings, contiguous compound matching, exact sentence rules and fallbacks. Use illustrative rules for the mechanical tests while signer review is pending. Check a frozen baseline replay and the Recognition Lab export format as additional inputs.

### Implementation and verification

- Implemented the [standalone caption runner](scripts/fsl_sandbox/run_captions.py) and [rules](scripts/fsl_sandbox/caption_logic.py). Reports show the original labels, lexical matches with input indices, output order and any fallback. Single-label display mappings are available by default. Illustrative compound and syntax rules require `--demo`. Custom rules can require manually annotated cues.
- The [fixture report](scripts/fsl_sandbox/runs/captions-20261114T075449046183Z.json) records 13 of 13 expectations passing. Additional checks exercised overlapping matches, invalid reorder indices, missing cues, fixture failures and a rejected recognition result.
- The [seed-42 recognition replay](scripts/fsl_sandbox/runs/20261114T075240219475Z.json) accepted all five presegmented clips with the expected labels. The [caption comparison](scripts/fsl_sandbox/runs/captions-20261114T075449460389Z.json) shows agreement between outputs from the expected labels and outputs from the model predictions for all three cases.
- An existing 43 Similar Signs camera export passed the importer. Its unsupported sequence fell back to the original labels. An Alphabet export failed the model check. These commands verified export handling. Fresh camera testing and signer validation of multi-sign examples are pending.
- Follow the [testing guide](scripts/fsl_sandbox/TESTING.md) and the [custom rules reference](scripts/fsl_sandbox/README.md#try-a-custom-caption-rule). The next step is to review complete examples with fluent Deaf FSL signers and record matching and counterexample cases before considering app integration.

## Recognition Lab baseline comparison · 2026-11-14

The user asked to expose 43 Similar Signs as a selectable baseline for live tests and clarified that the change belongs in Recognition Lab. Use the existing seed-42 `samples_43_signs_similarity_v1` route. Let the tester pin a completed baseline result and view it beside the next run. Verify that both model routes load, the selected model starts a fresh run with the same video or camera, and the baseline transcript stays pinned across model changes. This step covers the Lab comparison workflow.

### Setup and verification

- The [Lab selector](Frontend/src/pages/RecognitionLabPage.tsx) calls the existing `lab-signs43-similarity` route **43 Similar Signs (v1 baseline)** and selects it by default. **Pin baseline run** holds the completed run while the tester switches models. A new input source or replacement video clears the pin. Exports include the baseline transcript, recognizer ID and recognition settings alongside the current run.
- The [Lab comparison test](Frontend/tests/recognitionLabComparison.test.cjs) exercised camera-mode selection, stop, pin, model switching, both transcripts, export and clearing the pin with simulated camera and session events. The 81 targeted frontend tests passed. The real backend handler loaded v1, the [handshape-and-motion candidate](../SignSync%20Dataset/models/candidates/samples_43_signs_shape_motion_v1/samples_43_signs_shape_motion_v1/), then v1 again. Each accepted the same frozen `GOOD_MORNING` validation clip. That probe used an in-process WebSocket double.
- See the [application README](README.md#offline-fsl-testing) for how to compare runs. For a live check, keep the camera and recognition settings fixed and repeat the same signed sequence with each model. Replay the same loaded video for a direct input comparison. A fresh browser camera run is pending. The model files, Live Conversation and caption sandbox rules were outside the scope of this change.

## In-page Recognition Lab captions · 2026-11-14

The user asked to see caption output directly in Recognition Lab. Reuse the sandbox's English lexicalization and syntax rules through a small API that receives confirmed labels. Show the preview beside the original signs for one phrase per run, including in the pinned comparison. Verify outputs for the earlier `WAIT | PLEASE` camera example, the single-label phrase, the demo compound, and sequences without a rule. Check that resetting the run or switching models discards stale caption responses.

### Setup and verification

- [Recognition Lab](Frontend/src/pages/RecognitionLabPage.tsx) now puts **English caption preview** below **Confirmed signs** on the current run and pinned baseline. The preview refreshes when a new sign is confirmed. A new run starts a fresh phrase. Use **Retry caption** if the backend is temporarily unavailable.
- The first implementation used a caption API and a **Retry caption** button. The browser implementation below supersedes that API and retry workflow. See the [testing guide](scripts/fsl_sandbox/TESTING.md#4-try-a-single-utterance-from-video-or-camera) for current steps.
- The frontend build, 82 targeted frontend tests, and the caption endpoint test passed. The endpoint returned “Please wait.” using the confirmed labels from the earlier camera export and returned the expected lexical, compound and fallback outcomes. The sandbox's 13 fixtures also passed. Verification used automated UI state and in-process API requests. A fresh browser camera run and signer review of the demo rules are pending.

### Caption preview availability follow-up

The user's screenshot shows confirmed `WAIT | PLEASE` and a failed caption request. Move the deterministic preview to the browser using shared rule data. Verify the frontend against the sandbox fixtures and the reported label sequence. Remove the caption-only API dependency.

- The Lab now calculates previews from confirmed signs in the browser using shared display and demo rule files. The Python sandbox uses the same data. `WAIT | PLEASE` renders as “Please wait.” immediately, including for the pinned baseline. No caption request or backend restart is needed after the updated frontend is loaded.
- Verified the Lab rendering and comparison tests, all 13 browser and Python caption fixtures, the frontend build, and Vite development asset loading. The earlier request failure could not be traced to a specific running server. A fresh camera run remains unverified.

## Chat recap and current test rules

- Chose lexicalization before syntax so the caption engine can identify units of meaning before ordering them. A single sign may render as several English words. A compound rule groups adjacent confirmed labels. Syntax changes how those units are expressed in English.
- Built the isolated 43 Similar Signs sandbox first. Two initial replays matched all ten validation clips across four cases. Later added 13 caption fixtures, a five-clip caption replay, and support for Recognition Lab exports. The user's camera run confirmed `WAIT | PLEASE`. The CLI's default rules fell back, and rerunning with `--demo` produced [“Please wait.”](scripts/fsl_sandbox/runs/captions-20261114T081019468363Z.json).
- Verified the 43 Similar Signs v1 model architecture from the checkpoint. It uses 40 steps × 238 shape-motion features, GRU(64), dropout, Dense(32, ReLU), dropout and a 43-class softmax. Training uses sparse categorical cross-entropy. Recognition Lab segments gestures and confirms labels across windows before passing them to the caption preview.
- Made v1 an explicit Lab baseline and added pinning for side-by-side camera or same-video comparisons with the existing handshape-and-motion model. Model checkpoints and Live Conversation were outside this work. Captions initially used a separate API. When recognition succeeded and the caption request failed, moved the preview into the browser. Exports remain available for diagnostics.

Start a **fresh Recognition Lab run for each phrase**. The syntax demo requires the **entire confirmed sequence** to match an existing rule in order. Extra, missing, repeated or reordered labels prevent a match. The browser applies the same demo data as the offline sandbox.

| Confirmed labels | Expected English preview |
| --- | --- |
| `GOOD_MORNING` | Good morning |
| `FAMILY → FRIEND` | Family friend |
| `WAIT → PLEASE` | Please wait. |
| `TODAY → WAIT → PLEASE` | Please wait today. |
| `FRIEND → FAMILY`, `WAIT → WAIT → PLEASE`, or `TOMORROW → WAIT → PLEASE` | No caption rule matched these signs. |

### Proposed v2 work awaiting implementation

- Keep the v1 checkpoint and `(40, 238)` extractor. Compare a separate 43-class model with parallel 64-filter Conv1D branches of width 3 and 7, stride 1 and same padding, followed by concatenation, GRU(128), dropout, Dense(64, ReLU), and softmax. Benchmark the head on the same inputs before testing window-aware training-only speed and placement augmentation. The existing uniform timestamp jitter mostly preserves gesture placement after resampling. Check sampling, segmentation and confirmation misses before changing the window policy.
- Add an atomic shortcut class only with signer-verified examples of a distinct form and counterexamples of the literal sequence. The recorded `WAIT | PLEASE` established a two-label syntax test. It supplies no evidence of a fused sign.
- Proposed caption cascade uses event evidence to deduplicate the same gesture, keeps genuine repetitions, groups compounds, tries exact rules, then reviewed tag-based templates and a deterministic readable fallback. Keep model and caption versions independently selectable. `TOMORROW | WAIT | PLEASE` is a proposed generalization test for v2.
- Next check the browser preview with a fresh camera run. Then have fluent Deaf FSL signers review a complete positive example and a near miss for one lexicalization rule, followed by one syntax pattern. Record intended meanings and relevant non-manual cues. Benchmark any v2 candidate on held-out continuous recordings for shortcut recall, false accepts, existing-label accuracy and latency.

## V2 experiment · 2026-11-14

The user approved the v2 experiment and asked to select and compare v1 and v2 in Recognition Lab. Use the existing seed-42 43 Similar Signs checkpoint and frozen preparation as the baseline. Train the parallel Conv1D/GRU candidate on the same splits and compare saved evaluations. Check available continuous recordings and window decisions before drawing live performance conclusions. Verify both model routes, the pinned Lab comparison, and independently selectable caption behavior. Signer review and fresh camera verification require suitable recordings or a signer.

- The Lab model selector gives v2 its own diagnostic route and applies the same segmentation and motion-evidence policy used by v1. Caption rules have a separate selector so the same recognized labels can be compared independently. The pin and export preserve the selected caption rule version for each run.
- The v2 caption experiment preserves genuine repeats with distinct request IDs, suppresses repeated events carrying the same request ID and label, and uses an experimental temporal template after the existing exact rules. It renders `TOMORROW → WAIT → PLEASE` as “Please wait tomorrow.” Unmatched in-vocabulary sequences get readable glosses. Both versions passed their browser and Python checks. The examples are illustrative and await signer review.
- The architecture-only fit started on the frozen 2,671 / 572 / 573 clip split. Three archived development camera exports carry normalized frames without reference annotations and are available for exploratory replay.

- The seed-42 Conv1D/GRU candidate uses the same 43 labels, frozen splits and scaler. V1 scored 99.13% accuracy and 99.16% macro F1. V2 scored 97.73% and 97.87%. Architecture-only v2 is selectable for evaluation, and v1 remains the default. The saved v1 recipe used warm-start training and targeted augmentation. See the [run report](../SignSync%20Dataset/models/candidates/samples_43_signs_similarity_v2/samples_43_signs_similarity_v2/REPORT.md).
- The frontend build and Node suite passed. Backend tests passed with 29 passes and two opt-in skips. The [diagnostic socket-handler probe](../SignSync%20Dataset/models/candidates/samples_43_signs_similarity_v2/samples_43_signs_similarity_v2/recognition_lab_socket_probe.json) loaded v1, v2, then v1 and confirmed 6/6 frozen held-out clips for each. The probe used an in-process socket and real model inference. The Windows shell sandbox stalled on socket loopback; browser camera verification still needs a live signer.

- Both checkpoints produced `GOOD_MORNING` and `WAIT → PLEASE` on the two short archived recordings. On the longer development recording, v1 produced `HOW → SIX → WHAT → THREE → YESTERDAY → TODAY` and v2 produced `SIX → ONE → TWO → TUESDAY → PLEASE → TODAY`. The [replay report](../SignSync%20Dataset/models/candidates/samples_43_signs_similarity_v2/samples_43_signs_similarity_v2/continuous_development_replay.json) preserves identical source frames and confirmation policy for each comparison and records window decisions and inference timings. On the long replay, v1 logged 65 confirming windows and 36 below minimum confidence. V2 logged 76 and 38. The runs omit live camera scheduling and are unannotated. These counts cannot establish which signs were missed or incorrectly confirmed. Left the window policy in place.
- The separate training-only speed and placement experiment used 1,035 synthetic training windows and the same evaluation splits. It scored 96.86% accuracy and 97.15% macro F1 on the 573 original held-out clips. On 526 synthetic test windows, v1, v2 and augmented v2 correctly accepted 522, 510 and 511 clips respectively. The same models falsely accepted 31, 40 and 35 of the 51 isolated background clips. The augmented checkpoint remains a separate run. See the [augmented evaluation](../SignSync%20Dataset/models/candidates/samples_43_signs_similarity_v2_window_aug/samples_43_signs_similarity_v2_window_aug/evaluation.json).
- Try the [Lab comparison steps](scripts/fsl_sandbox/TESTING.md#compare-v1-and-v2-in-recognition-lab). A fresh signed browser run, signer review of the experimental language rules, and continuous recordings with independent reference annotations are pending. No fused shortcut class was defined because this experiment had no signer-verified fused examples.


## Sign gloss notation pilot · 2026-11-14

The user asked to record this chat and plan SignSync's gloss notation. This continues the existing lexicalization work. The goal is to make signed utterances reviewable against video and give the caption engine a stable vocabulary. Start with the seed-42 43 Similar Signs v1 and v2 label set, the Lab transcript and the shared caption fixtures.

### Proposed conventions

| Record | What it represents | Example |
| --- | --- | --- |
| Model label | Exact class emitted by a versioned recognizer | `GOOD_MORNING` |
| ID gloss | Stable lexicon identifier for a sign form or entry, with a readable display gloss | A reviewed entry displayed as `GOOD-MORNING`, if the recorded form is confirmed |
| Gloss sequence | Timed sign tokens in observed order | `WAIT PLEASE` |
| Translation | Utterance meaning in a specified written language, with alternatives where appropriate | English demo output “Please wait.” |

The examples illustrate the notation and current demo output. Deaf FSL reviewers will establish the sign identities and judge the translations. Benilde CEAD documents FSL signs with ID glosses in ELAN. Use its entries as references when the recorded form matches and retain the source reference alongside the local ID. [Benilde CEAD FSL Signbank](https://cead.benilde.edu.ph/fsl-signbank/)

- Keep the recognizer's strings and class indices intact. Maintain a versioned mapping keyed by model label-set version and exact label. Each mapping can be pending, reviewed, ambiguous or a background class. Resolve ambiguous forms against video. Preserve unresolved labels in diagnostics and require a reviewed mapping for rules that depend on lexical identity.
- Use an opaque stable local ID and an uppercase display gloss. Spaces separate sequential tokens. Use a hyphen within a multiword display gloss for one confirmed lexical unit and record variants and related forms in lexicon fields. Review the decision to share or split IDs against attested forms and usage. Keep display-name edits independent of ID changes.
- Give each occurrence its own token ID and start/end time in milliseconds relative to the source video. Write genuine repetition as `WAIT WAIT`. Retain the current v2 replay deduplication by request ID and label for predictions. Ground-truth token boundaries and repetitions come from manual review. Record multi-token compounds as spans over the original tokens. Give a fused form one token only when signers verify it as a distinct lexical unit.
- Annotate non-manual observations on a timed tier that can overlap one or more signs. Record the observed cue and its proposed function in separate fields, with review status. Distinguish unannotated, not visible, and observed absent. Keep pointing, fingerspelling and depicting forms as structured token types when they enter the pilot. Use an explicit unresolved status when a reviewer cannot identify a form. [Rivera and Ong, Recognizing Non-manual Signals in Filipino Sign Language](https://www.sign-lang.uni-hamburg.de/lrec/pub/18040.html)
- Record the source video reference, anonymous signer and session IDs, utterance interval, reviewer status and schema/lexicon versions. Each manual token carries its timing, type and lexicon ID when resolved. The translation tier stores utterance-level references with language tags and contextual notes. Keep prediction events, with their recognizer version and confidence, distinct from the reference annotations.

### Pilot and acceptance

1. Seed a draft mapping from the 43-label vocabulary. Start review with the classes used in the existing `GOOD_MORNING`, `WAIT PLEASE`, `TODAY WAIT PLEASE` and `TOMORROW WAIT PLEASE` fixtures. Inspect representative video and record mapping status and references. Include a genuine repetition and an ambiguous or unsupported form in the review set.
2. Have fluent Deaf FSL reviewers annotate a small set of complete, consented recordings independently. Include a positive utterance and a near miss for each candidate rule. Reconcile disagreements in sign identity, timing, cue scope and meaning before using the annotations as references. Keep archived camera traces as development replays until usable reference annotations exist.
3. Prototype versioned JSON or ELAN-compatible tiers offline first. Check that a saved annotation round trip preserves order, repeat count, unresolved tokens, overlapping cues and translation language. Run captions from reviewed gloss sequences to isolate caption rule errors, then replay the same videos through both Lab models and compare predicted signs to the references. Check insertion, deletion and substitution counts, timing where available, and signer-reviewed caption meaning.
4. After the pilot, expose the gloss sequence in Recognition Lab alongside the confirmed model labels and English caption preview. Include mapping and schema versions in future exports and check old exports against the existing caption fixtures. Decide with reviewers which glosses, cues and caption languages are ready for broader use.

This chat covered the log update and the proposal. Checked the current chat history, both vault guides, the earlier FSL work note, the shared display data and the Lab caption code. The earlier v2 experiment is recorded above. The next step is to review the starter mappings against video and agree on annotation boundaries with Deaf FSL reviewers. The schema, mappings and examples here are proposed.


## Recognition Lab gloss implementation · 2026-11-14

The user corrected the pilot scope to lexical signs, numbers, unresolved manual signs and reduplication, with fingerspelling represented in the schema. They asked to build this directly in Recognition Lab. The schema covers manual signs. Automatic Alphabet grouping is deferred until continuous letter and word boundaries are validated.

Use the shared 43 Similar Signs vocabulary for deterministic, provisional suggestions from the v1 and v2 transcripts. Add a timed review track for video and camera runs, preserve repeats and recording ownership, and include gloss data in the diagnostic export and pinned comparison. Verify the four camera test sequences via simulated Lab events, timing edits and linked reduplication, export and model switching, then run the frontend build.

### Delivered

- [Recognition Lab](Frontend/src/pages/RecognitionLabPage.tsx) shows gloss suggestions for both 43 Similar Signs models. The versioned lookup uses exact class labels and supplies local draft IDs, display glosses and numeral values. Duplicate request-and-label deliveries produce one suggestion. Distinct occurrences keep their order. Suggestion timing comes from the inference window and is editable.
- The [gloss editor](Frontend/src/components/live/LabGlossTrack.tsx) supports lexical, number, unresolved, reduplication and manually entered fingerspelling annotations. Reduplication links to component annotations within its span. Timing is relative to video start or the first observed camera frame. Facial landmarks and non-manual annotation are outside this pilot.
- Recognition reports preserve the original transcript and add a versioned gloss block. Video runs share annotations while the same file is loaded. A pinned camera baseline retains its own annotations. Annotation storage is session-local, with JSON export for retention. The caption engine still uses the confirmed recognition transcript.

### Verification

- Targeted tests passed for the four proposed transcripts, numeral value, duplicate requests, camera pinning, video file isolation, annotation validation, reduplication links and fingerspelling with repeated letters. The production build passed.
- Follow the [Recognition Lab camera instructions](README.md#sign-gloss-notation-in-recognition-lab) for the four live signing trials. Fresh camera verification and review of the draft mappings by fluent Deaf FSL signers are pending.
- The complete frontend Node suite passed all 316 tests.

### Camera check and notation follow-up

- The 31.114 s v2 camera export confirmed WAIT, PLEASE, GOOD_MORNING, WEDNESDAY, SIX, WAIT, WAIT in that order. The Lab exported seven pending gloss suggestions, GOOD-MORNING as one lexical token, SIX as NUMBER with value 6, and two separate final WAIT occurrences. WEDNESDAY was confirmed at 16.25 s with a 76.4% model score. Its intended label was unverified. No manual annotations were saved in that export.
- The user clarified reduplication as deliberate movement repetition within a sign with a grammatical function. Use TOKEN+ in the proposed notation, with WORK+ as the user's illustrative “working” example. Separate WAIT occurrences use WAIT WAIT. The current Lab still displays REDUP spans. The TOKEN+ change is pending.
- Discussed lexical IDs, numerals, fingerspelling, unresolved signs, indexing, possessives, depicting signs, buoys and manual gestures. Direction and incorporated numbers can be token attributes. Facial landmarks and non-manual markers are outside the pilot.
- A meaningful buoy can overlap an active sign. For the resting-hand duplication issue, test a single sign with the other hand visible and still, then repeat after a pause. Expect one entry per occurrence. Gloss annotation of a buoy and recognition of an active gesture are separate tasks.
- A compound is a lexical entry built from multiple sign forms. Record PARENTS as one entry with FATHER^MOTHER as component notation when a reviewer confirms that form. Record FATHER MOTHER as two tokens when signed as separate items. GOOD-MORNING is the display gloss. GOOD^MORNING is a proposed compound analysis pending signer review. Timing is evidence alongside context.
