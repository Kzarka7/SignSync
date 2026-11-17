# SignSync conversation log

This log is kept in both the SignSync project and SignSync Dataset Obsidian vaults. Entries record what we discussed, decisions, changes, verification, and open questions.

## 2026-11-13 — Obsidian setup and logging

- Opened the SignSync project root and its sibling SignSync Dataset folder as two Obsidian vaults.
- Added links between the two root READMEs. Opening the dataset link from the project README brought the dataset README to the front in Obsidian.
- A Windows directory symbolic link named `dataset-link` was created with a placeholder target. It was later confirmed absent. The vaults use the README links for navigation.
- Verified that Obsidian registered both active vault roots. Moved the older nested `SignSync/SignSync` vault, which contained only the default welcome note and local settings, to the Recycle Bin.
- Discussed recording the dataset version, manifest, training command, and results under `experiments/` for future dataset experiments, and linking related app changes to the experiment note.
- The user asked to check both vaults before every task and keep both vaults updated with the conversation going forward.

## 2026-11-14 — FSL lexicalization and syntax planning

- Discussed support for visual shortcuts and compound signs, followed by sequence reordering and syntax shifting.
- Recommended starting with a signer-reviewed lexicon for the current Signs model, then trying one sentence pattern with annotated utterances. The proposed pilot translates FSL signing into written captions. The production caption language is open.
- The plan records the current recognition handoff, candidate vocabulary, review and replay requirements, and the first implementation milestone.
- Saved the discussion in [[2026-11-14 FSL Lexicalization and Syntax Plan]].

## 2026-11-14 — 43 Similar Signs controlled environment

- The user requested an isolated test environment for 43 Similar Signs and asked to defer integration.
- Created an offline runner using the seed-42 recognizer and fixed validation clips. Two runs each correctly recognized and accepted 10 of 10 clips.
- Setup and reports are recorded in [[2026-11-14 FSL Lexicalization and Syntax Plan#Controlled environment · 2026-11-14|the FSL work note]].

## 2026-11-14 — Offline lexicalization and syntax prototype

- The user requested implementation of the lexicalization and syntax plan and detailed testing instructions.
- Built the standalone English caption prototype on the 43 Similar Signs sandbox. Multi-sign demo rules are illustrative and require signer review.
- Verified 13 caption expectations, five correctly accepted replay clips, and compatibility with a saved Lab camera export.
- The instructions, reports and signer-review follow-up are linked from [[2026-11-14 FSL Lexicalization and Syntax Plan#Lexicalization and syntax prototype · 2026-11-14|the FSL work note]].

## 2026-11-14 — Recognition Lab baseline comparison

- The user asked to compare live recognition modes in Recognition Lab before integrating the new model and captions.
- Kept 43 Similar Signs as the default v1 baseline and added a pinned transcript for comparison against another Lab model. The export identifies both runs.
- Test results and usage are recorded in [[2026-11-14 FSL Lexicalization and Syntax Plan#Recognition Lab baseline comparison · 2026-11-14|the FSL work note]].

## 2026-11-14 — In-page Recognition Lab captions

- The user asked to see captions directly in Recognition Lab.
- Added a live English caption preview below the confirmed signs. The API reuses the offline sandbox rules and produces “Please wait.” from the earlier camera transcript.
- Testing and usage are recorded in [[2026-11-14 FSL Lexicalization and Syntax Plan#In-page Recognition Lab captions · 2026-11-14|the FSL work note]].

## 2026-11-14 — FSL prototype chat recap

- Recorded the sandbox, model architecture, Recognition Lab comparison, browser caption fix, exact demo conditions and proposed v2 work in the [[2026-11-14 FSL Lexicalization and Syntax Plan#Chat recap and current test rules|FSL work note]].

## 2026-11-14 — Record chat activity

- The user asked to record everything done in this chat. Checked the Codex history and confirmed that this chat contains the logging request and the work to fulfill it.
- Reviewed the READMEs, landing notes, and conversation logs in both vaults. The earlier FSL prototype discussion already has its own recap in the work note.
- Added and verified this entry in both vaults. This chat made documentation changes only.

## 2026-11-14 — 43 Similar Signs v2 experiment

- Trained a parallel Conv1D/GRU candidate and a separate speed and placement augmentation run using the frozen v1 split. V1 scored 99.13% accuracy on the 573 test clips. V2 scored 97.73% and the augmented run scored 96.86%. Kept v1 as the default and made v2 selectable in Recognition Lab.
- Compared the checkpoints through the diagnostic recognition handler and on three archived camera traces. Added separate caption rules for testing the temporal template and fallback. Fresh camera testing, signer review and annotated continuous evaluation remain open.
- The settings, evaluation, and testing steps are saved in the [FSL work note](obsidian://open?vault=SignSync&file=2026-11-14%20FSL%20Lexicalization%20and%20Syntax%20Plan).

## 2026-11-14 — Plan sign gloss notation

- The user asked to record this chat and plan how SignSync handles sign gloss notation. Codex history showed this request started the chat. The earlier v2 experiment is recorded in its own entry above.
- Reviewed both vaults, the existing FSL sandbox and Lab caption handoff, and FSL annotation references. Drafted a versioned mapping from recognition labels to reviewed ID glosses, timed annotation tiers, and an offline pilot for evaluating glosses and captions.
- This chat updated vault documentation. Signer review and sample annotation are pending. See [[2026-11-14 FSL Lexicalization and Syntax Plan#Sign gloss notation pilot · 2026-11-14|the sign gloss notation pilot]].


## 2026-11-14 — Compare the Cueto et al. FSL animation study with SignSync

- The user shared Cueto et al. (2020) and asked how its research and findings differ from SignSync's and to record the discussion. Reviewed the paper, the 43 Similar Signs v1 and v2 results, and the FSL gloss and caption plan.
- Cueto et al. manually annotated an existing FSL telling of The Tortoise and the Hare in ELAN using hand action units, glosses, and English sentences. They used the annotations to build a Blender avatar video with English text and illustrations as an educational prototype. SignSync uses a webcam, hand and pose landmarks and a trained temporal classifier to identify signs for a conversation assistant. Recognition Lab uses confirmed labels to preview English captions through limited demo rules.
- Five adult Deaf FSL signers rated the paper's video on a six-point scale. Mean ratings were 5.2 for willingness to use it as a learning reference, 3.4 each for animation accuracy and naturalness, and 3.0 for sign understandability. Reviewers flagged signing variants, unclear or fast motion, and absent facial expression. These ratings describe adult reviewer feedback on one video. The study did not measure learning gains in children.
- SignSync's 43 Similar Signs v1 scored 99.13% accuracy and 99.16% macro F1 on 573 held-out isolated clips. On the same split, Conv1D/GRU v2 scored 97.73% accuracy and 97.87% macro F1. Signers could appear in multiple splits. V1 also falsely accepted 31 of 51 isolated REST and IDLE_MOVEMENT clips at the backend clip gate. These results concern clip classification and rejection. The paper's ratings concern perceived quality and usability. SignSync still needs signer-reviewed caption evaluation on annotated continuous recordings.
- The closest methodological overlap is glossing and English sentence reconstruction. The paper found that phrase-level annotation made individual signs hard to align. SignSync's proposed pilot addresses that with timed sign tokens, stable gloss IDs, and a separate utterance translation. The paper's comments on signing variation and facial expression are relevant to what the pilot records and what signers review. No implementation decisions were made in this discussion.

Sources: [Cueto et al., 2020, sections 3–5](https://aclanthology.org/2020.signlang-1.7/) · [43 Similar Signs v1 pilot report](obsidian://open?vault=SignSync%20Dataset&file=models%2Fcurrent%2Fsamples_43_signs_similarity_v1%2Fsamples_43_signs_similarity_v1%2Fpilot_report) · [v2 report](obsidian://open?vault=SignSync%20Dataset&file=models%2Fcandidates%2Fsamples_43_signs_similarity_v2%2Fsamples_43_signs_similarity_v2%2FREPORT) · [FSL lexicalization and syntax plan](obsidian://open?vault=SignSync&file=2026-11-14%20FSL%20Lexicalization%20and%20Syntax%20Plan)

## 2026-11-14 — Recognition Lab sign gloss notation

- The user selected lexical signs, numerals, unresolved signs, reduplication and fingerspelling for the manual gloss schema, asked to work directly in Recognition Lab, and planned four live-camera checks. The Conv1D + GRU model is already available in the Lab as 43 Similar Signs v2.
- Implemented provisional gloss suggestions for v1 and v2, timed manual annotations, and versioned JSON exports. Reduplication annotates a pattern while preserving its component signs. Fingerspelling supports manual entry. The English caption preview still reads confirmed signs.
- See [[2026-11-14 FSL Lexicalization and Syntax Plan#Recognition Lab gloss implementation · 2026-11-14|the FSL work note]] for the implementation, verification and camera test steps.


## 2026-11-15 — Possessive Collector labels

- Discussed collection prompts for indexing and possession in singular and group contexts. The user finalized the possessive labels and asked to add them to a separate Collector category and create a raw folder.
- Added six searchable options under **Possessives**, including `POSS-2pl` for “Your/Yours (you all)” and `POSS-3pl` for “Their/Theirs.” Created `raw/possessives/` in the dataset vault. See [[2026-11-15 Possessive Collector Labels]].

## 2026-11-15 — Gloss, Collector and dataset recap

- Reviewed the v2 live gloss export, clarified TOKEN+ reduplication, and discussed indexing, possession, compounds and resting-hand false duplication. The implemented Lab and pending notation work are in the FSL work note.
- Added and tested six Indexing and six Possessives labels in the Collector and pushed the change to NF, main, pipeline and ui-ux. Created raw/possessives for exports.
- Audited the new collection, then moved and verified 64 batches with 1,280 samples across 32 signs. The processed archive audit found 200 repeated E/X samples in their combined exports. No archives were removed during the duplicate audit.
See [[2026-11-14 FSL Lexicalization and Syntax Plan]], [[2026-11-15 Possessive Collector Labels]] and the [dataset transfer note](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Batch%20Transfer).


## 2026-11-15 — Record this chat

- The user asked to record everything we do in this chat.
- Reviewed the READMEs, landing notes, and conversation logs in both vaults. Started this entry in both logs for requests, discussions, decisions, changes, verification, and pending work from this chat.


- The user requested preparation of the 32-sign batch, retraining against the verified Recognition Lab baseline, evaluation and candidate testing, with signer review and camera testing as needed. The current default stays selected pending the user's decision. See [2026-11-15 New 32 Signs Recognition Lab Retraining](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining).


- Imported and audited 1,280 clips from 64 batches across 32 signs. Trained one held-out batch experiment and one multi-batch candidate against the verified v1 baseline. The new labels scored 35.16% on unseen batches and 97.92% on held-out clips within batches represented in training. The multi-batch fit scored 98.08% on the 573 original sign clips versus v1's 99.13%. Both candidates reduced isolated background false accepts to 1/51 from 31/51.
- Verified the candidate route and compared four archived camera traces. Made the multi-batch candidate selectable in Recognition Lab and kept v1 as the default. The user asked for a list of clips to review later. Saved the 24-clip FSL review queue and fresh camera comparison steps in the [retraining work note](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining).

- The user asked about the data split. The multi-batch candidate used 3,618 train / 815 validation / 816 test. The first experiment used 3,202 / 783 / 1,264. Both retained the v1 splits and added 51 background clips per split. New signs used 28 / 6 / 6 per label for the multi-batch fit and 15 / 5 / 20 for the whole-batch holdout.

- The user reported that most signs were wrong with the 75-sign candidate in Recognition Lab. Discussed training the 32 new signs separately and evaluating across recording batches before merging. The user approved proceeding with the standalone retraining.

- Trained 32 signs separately, plus two non-emitting background classes. Whole-batch tests scored 31.88% and 36.09%, and the Lab candidate scored 97.92% on clips from familiar batches. Checked isolated clips, out-of-vocabulary signs and continuous replays. Added the standalone Lab option and retained the verified 43-sign default. FSL review and fresh camera tests remain pending. See the standalone section of the linked retraining work note.

- Reproduced "Unknown recognition model" on the local WebSocket. The running SignSync backend predated the standalone route. Restarted it on port 8000 with backend reload enabled and verified that the 32-sign checkpoint returned Ready over the actual WebSocket. Updated the local startup command in README.

- The user reported continued poor live recognition and asked how to review landmarks. Identified the Collector video preview workflow and the original PERSON/STUDENT filenames for cross-batch review. The legacy Python comparison viewer targets participant datasets.

- The user clarified that they wanted the compare_landmarks.py command. Verified a PowerShell invocation that loads one archived PERSON take from each batch into the viewer without changing the source files.

- The user asked why clear signing still fails live despite high held-out clip accuracy. Checked live windowing and available exports. No fresh 32-sign camera export was found. Ran a read-only boundary sensitivity check on identical stored landmarks. The model correctly accepted 185/192 full clips and 171/192 when the last quarter was removed, with two wrong accepts after trimming. Whole-batch accuracy was much lower, so proposed diagnosing a fresh live export by comparing the manually marked complete gesture with the Lab window for the same take.

- Consolidated the retraining, backend fix, landmark comparison command, live diagnosis and pending camera check in the existing retraining work note.


## 2026-11-15 — Plan the 32 Signs standalone Recognition Lab fix

- The user reported that the new **32 Signs (standalone candidate)** is performing badly in Recognition Lab and asked to plan the fix. They asked that all work in this chat be recorded, starting with this entry.
- Opened both vaults and reviewed the project and dataset READMEs, landing notes, sample training guide, earlier conversation entries, and standalone retraining and evaluation notes. The existing [retraining work note](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining) will carry the diagnosis and plan.

- Traced the Lab selector through the segmented gesture policy and backend checkpoint verification. The standalone preset uses a 0.90 backend score floor, with browser confirmation applied afterward. The standalone export contains normalized landmarks, scored windows, transcript and tracking decisions. Its Lab gloss editor is unavailable, so the intended signs and times will be recorded separately.
- Searched both vaults and Downloads for standalone captures. The available standalone replays use stitched clips or an older unannotated camera trace. The six local Lab camera exports identify Alphabet or 43-sign recognizers. A fresh annotated standalone run remains pending.
- Rechecked the frozen scores. The candidate ranked 188/192 familiar-batch signs first. The reciprocal holdouts ranked 204/640 and 231/640 first. Reducing the candidate's score floor from 0.90 to 0.75 retained the same 185 correct accepts and increased older-sign false accepts from 209/573 to 324/573 on isolated clips. The held-out-batch models also made many wrong accepts at 0.90.
- Saved the live fix plan in the existing work note. Start with a camera trial of PERSON → STUDENT three times and FAST twice, including neutral pauses and ordinary hand movement. Compare complete gestures and actual Lab windows from the same normalized frames. Use the result to decide which change to test in capture, segmentation, confirmation, training data or rejection. The plan specifies checks on the pilot and on fresh sessions. No model, code, or recognition settings were changed in this planning pass.

- The user asked whether the standalone model uses a different approach from the 43 Similar Signs v1 Lab baseline. Verified both saved architectures, frozen training code, and runtime settings. Both use the same 40-frame, 238-feature shape-and-motion input and shared segmented confirmation policy. Baseline v1 fine-tunes a 64-unit GRU and 32-unit dense layer from the earlier 43-sign shape-and-motion checkpoint, keeps its scaler, and emphasizes ONE/WHAT and SIX/WEDNESDAY. Standalone trains a 96-unit GRU and 64-unit dense layer from scratch, fits its scaler on standalone training clips, and balances training rows by class frequency. It uses 32 sign classes plus REST and IDLE_MOVEMENT, compared with 43 sign classes in v1. Both augment training clips. The standalone uses a 0.90 backend gate versus 0.54 for v1, and v1 has vocabulary-specific motion checks in the Lab. The runs differ in vocabulary, data, and training, so the scores do not isolate the effect of model architecture.


- Reviewed the user's four-part proposal without editing files. Verified that the current standalone uses GRU(96), already normalizes planar coordinates, and computes timestamp-based wrist velocity. The two FAST outputs were intended. The erroneous MAYBE came from the first 768 ms of an AGAIN clip that the checkpoint classified correctly in full.
- The user then authorized proceeding. Started a same-checkpoint, same-landmark trigger comparison in the existing retraining work note.


- Replayed three trigger policies against the same seed-42 checkpoint and four fixed landmark exports. Current confirmation found all 11 intended stitched signs and inserted an early MAYBE during AGAIN. The existing completion and short-preview modes dropped all 11 when the synthetic seams caused unverified hand loss. Direct inference on the complete labeled intervals correctly accepted all 11 and accepted none of three background intervals. The older unannotated camera trace still produced GRANDMOTHER with each policy.
- Saved the replay runner, results and decision in the retraining work note. All 69 focused frontend tests passed. The application and checkpoint were untouched. Asked for one fresh annotated standalone export to measure real gesture endings before changing the trigger.


- The user declined fresh PERSON/STUDENT samples and asked for the next step. Found unused 20-take landmark archives for both labels with no indexed ID, file hash or source fingerprint overlap. Scored both without importing them. The STUDENT export ranked PERSON on 11/20 complete clips and STUDENT on 6/20. Only two STUDENT predictions passed the gate. All 20 source filenames in the PERSON export say PARENTS, so the labels need review.
- Found at least one unused 20-source export for each of the 32 labels. The next step is to audit those archives and reserve reviewed groups for a classifier comparison. The pair's landmark ZIPs cannot establish performance on continuous gesture endings. No model, app or dataset index changes were made.


- The user asked for the next concrete step. Screened all 44 unused ZIPs and 862 clips for the frozen schema, metadata, label aliases, Collector approvals and duplicate identities. Found 34 unprobed 20-take archives across 30 labels pending label review. The PERSON/PARENTS filename conflict was the only explicit cross-label prefix flagged. The already-probed PERSON and STUDENT archives are development cases. The unused exports lack signer and session metadata. Saved the audit with the retraining work note. No samples were imported or model scores run.


- The user asked which proposal changes had been implemented and what was available in Recognition Lab. Rechecked the selector, active confirmation path and backend mapping. The Lab source offers the existing seed-42 32 Signs standalone candidate for Camera and Video, while 43 Similar Signs v1 is the default. The prior work added offline replay and archive reports and a replay runner. No proposed feature, training, architecture, UNK or live trigger change is in the app. This session could not reach localhost port 8000, so live availability was not verified.


- The user confirmed they preferred to avoid new recordings and authorized implementation of the torso-roll experiment. Added a versioned transform and reused the three standalone folds, model recipe and original synthetic views. Verified 1,376 views before applying the change and compared paired model predictions on unchanged tests. Top-1 changed from 204 to 200 and from 231 to 271 on the two held-out batches. The mixed-batch model tied at 188/192 and accepted 233 older-sign clips at 0.90 versus 209 for v1.
- Saved the three candidates offline. The result did not support adding another Lab model. Verified checkpoint hashes and tested six real sample requests through the offline diagnostic graph. No new recordings were needed or collected.

- Explained how the offline train, validation and held-out archive splits work, what top-1 and confidence-gated counts measure, and how to replay existing footage with the current standalone Lab model. The torso-roll candidate remains offline.

- Confirmed frozen partitions. The selectable standalone and its mixed-batch torso-roll comparison use 70/15/15 of the 40 selected clips per sign, or 28/6/6 (896/192/192 signs plus 51 background clips per split). Each reciprocal holdout uses 15/5/20 signs per class (480/160/640 plus background). The 862 additional archived clips have no assignments in these runs.

- Clarified why per-sign archives preserve provenance and why reciprocal whole-archive holdouts serve a different purpose from the 70/15/15 mixed-batch split. A and B are the two selected archives for each sign. Validation stays within the development archive and final scoring uses the opposite archive. A held-out archive does not establish a held-out signer when signer IDs are missing.

- Compared the splitting protocols. 43 Similar Signs v1 retained the frozen 70/15/15-style 2,671/572/573 clip assignments, separating known recording fingerprints while allowing shared signers and batches. The 32-sign mixed-batch split uses the same style of clip-level evaluation, with extra reciprocal whole-archive runs.


- The user asked to apply the 43 Similar Signs v1 training and testing approach to the 32 signs. Completed the sign-only shape-and-motion GRU and warm-start similarity fine-tuning on the mixed split and the two reciprocal archive splits, using the existing recordings.
- The recipe tied standalone top-1 on the 192 mixed-batch clips and had mixed whole-archive results. At 0.90 it accepted fewer correct signs, falsely accepted more background and fewer older signs. Both models reproduced the extra MAYBE in the stitched replay.
- Added a selectable Lab recipe and the ability to pin a 32-sign standalone run for a same-video comparison. The 43-sign default remains selected. The frontend build and 74 focused tests passed. Both reports and trial instructions are linked from the retraining work note and READMEs.

The in-process WebSocket handler returned Ready and matched frozen scores on one request per class. It correctly accepted 30/32 at the model gate.

- The user reported poor Recognition Lab predictions from both 32-sign models despite visible differences between signs. Listed plausible faults in sample coverage and labels, the shared placement and handshape representation, landmark tracking, live window boundaries, temporal resampling, and score rejection. Existing whole-clip archive errors and the early AGAIN/MAYBE replay support separate investigation of the classifier and Lab windowing.

- 2026-11-17. Planned per-take annotations and comparisons across all archives for the 32 signs. The plan preserves source labels and distinguishes reviewed FSL identity, signing variation, and tracking. No samples were relabeled.

- Planned compare_landmarks.py archive mode for side-by-side review of all batches, stable batch/take IDs, raw playback and per-take review records. The viewer implementation and relabeling are pending.

- Implemented read-only archive playback in compare_landmarks.py. Use --batches --label PERSON, with --samples 7 for the same take number across all batches or one number per batch for individual selection. ZIPs and takes are ordered by filename. Verified sample 1 loads and has visible landmarks in all 108 batches across 32 signs (20 signs with three batches and 12 with four), rendered a four-batch FATHER GIF with separate sample numbers, and verified the existing v5 STAY participant command loads with the headless renderer.

- Listed the 32 new sign labels from the standalone model's frozen label map.

- Audited 108 batches by source filenames. The viewer labels all-WEBM batches P1 and all-MOV batches P4 per the user's mapping. The other groups are WIN MP4 (31 batches) and Named MP4 (32 batches), plus one mixed STUDENT archive. P2 and P3 identities are unconfirmed. Verified viewer labels on FATHER and STUDENT.

- Checked the STUDENT WIN and mixed MP4 archives for participant IDs. Source filenames establish recording groups but the archives provide no signer IDs.

- Audited all 12 SCHOOL AND PLACES archives. P1 corresponds to each WEBM archive by the user's rule. The user confirmed P2 Joem for the 11-14 STUDENT archive. The other all-WIN archives are proposed P2 and the sign-named MP4 archives proposed P3 Almari. The mixed 11-13 STUDENT archive has 19 sign-named files and one WIN outlier, which remains unassigned individually. The viewer and source labels were unchanged.

- Completed the viewer mapping and a linked inventory for all 108 archives. Verified 32 P1, 31 P2 (one confirmed and 30 inferred), 32 all-named P3, 12 P4, and one mixed STUDENT batch (19 inferred P3, one unassigned). Tested FATHER and the exact STUDENT outlier in the viewer loader. No training metadata changed.

- Verified the missing P2 archive assignment is FAST. Clarified that the 31 P2 mappings are one confirmed and 30 inferred.

- Confirmed FAST mapping from the user: Nov 14 20-56-07 is P2 Joem and Nov 15 02-49-30 is P3 Almari. Updated the viewer and 32-sign linked inventory. All signs now have a P2 and P3 assignment, with the mixed STUDENT WIN take still unassigned.

- Updated compare_landmarks.py so batch panels use P1–P4 order and show source filenames. A list of sample numbers follows displayed panel order. Verified a FAST four-panel render, positional samples, the unassigned STUDENT take 18 in the mixed archive's P3 slot, and a v5 STAY participant render.

## 2026-11-17 Recognition Lab FPS

- The user asked to record the full chat, maximize FPS in Recognition Lab first, and plan later adoption in other tabs. Reviewed the app flow and inventoried hand and pose landmark files. Both landmark tasks execute serially in the current main-thread and paired worker paths. Worker round-trip scheduling, delegate fallback, detection input size, overlay, recognition observer and camera cadence are benchmark candidates.
- Recorded the full plan in [[2026-11-17 Recognition Lab FPS Plan]] and linked it from [[Project Home]]. The first action is to export repeated foreground camera benchmarks across inference modes and input sizes, then check recognition quality before selecting a candidate. No runtime changes or measured FPS results yet.
- The user reported 9–16 FPS, usually 10–13, on an IdeaPad S340 with a Ryzen 5 3500U, 12 GB RAM and an SSD. Found five November 10 benchmark exports. The 11.38 FPS worker run showed 28.17 presented FPS, GPU reported for both models, 56.92 ms combined mean inference and 29 ms mean between callbacks. Main-thread runs ranged from 13.78 to 21.42 processed FPS with the same recorded landmark settings. Added the timing table and hardware-specific checks to the FPS work note. The exports omit device and power conditions. No current run or runtime change was made.

- Made compare_landmarks.py maximize interactive windows at startup with a full-screen fallback. Tested the Tk, Qt, wx, fallback, and noninteractive paths with simulated window managers. GIF export bypasses the window sizing code.


## 2026-11-17 — 32 Signs recognition and landmark review chat recap

- Investigated poor live predictions from both 32-sign models. Matched clip scoring showed that the original model got 188/192 top-1 with familiar batches and 204/640 or 231/640 on reciprocal whole-archive holdouts. Reviewed shared placement features, tracking, training coverage, labeling, resampling, and early Lab confirmation as possible failure points.
- Replayed the same landmarks through confirmation, completion, and preview. Current confirmation emitted the 11 intended stitched signs plus an early MAYBE during AGAIN. Direct complete-gesture scores got 11/11. Both completion variants lost all 11 at synthetic gaps reported as unverified hand loss. Kept the existing trigger and preserved the replay runner and report.
- Continued using existing recordings at the user's request. Audited 44 unused ZIPs with 862 clips. Identified 34 unscored 20-take archives covering 30 labels for review. The unused STUDENT batch ranked PERSON on 11/20 complete clips. The unused PERSON archive's filenames say PARENTS. These findings are provisional pending sign identity review.
- Trained three matched torso-roll runs with the same archived splits and GRU96. Top-1 changed from 204 to 200 and 231 to 271 across the two reciprocal holdouts, with 188/192 on the mixed split. At a shared 0.90 floor, older-vocabulary false accepts increased from 209 to 233 of 573 for the mixed model. Kept the torso-roll candidates offline.
- Applied the 43 Similar Signs v1 recipe to 32 signs with a GRU64, warm-start fine-tuning, and targeted training-only augmentations. Explained the 70/15/15 mixed split and reciprocal archive holdouts. The new candidate tied the original at 188/192, with reciprocal holdouts of 191/640 and 250/640. At the shared 0.90 floor it produced fewer older-vocabulary false accepts and more background false accepts. Added **32 Signs (similarity recipe)** to the Lab and enabled pinning a 32-sign standalone run. The 43-sign default remains selected. Verified the frontend build, 74 focused tests, and one real checkpoint request per class through the in-process diagnostic handler. Continuous camera performance is unverified.
- Planned visual comparison and per-take annotation across each sign's three or four archives. Implemented the narrower viewer update requested by the user. The script reads archived landmarks for all 32 signs across 108 ZIPs, shows P1–P4 in display order, displays source filenames and sample numbers, and uses existing playback controls. No annotation editor or source relabeling was added. Verified archived loading, four-panel FAST rendering, the mixed STUDENT take, and existing participant playback. The interactive viewer opens maximized with a full-screen fallback. Window dispatch passed simulated tests. Desktop window size was not verified.
- Mapped P1 to WEBM and P4 to MOV. P2 is Joem and P3 is Almari. Confirmed Joem's November 14 STUDENT archive, plus Joem's November 14 FAST and Almari's November 15 FAST archives. Other P2/P3 assignments are based on filenames. All signs have P1–P3 assignments, and 12 signs have P4. The mixed STUDENT archive has 19 inferred Almari takes and one unassigned WIN clip at take 18. The mapping is for the viewer and inventory. Training labels and split assignments were untouched.
- The user supplied the AGAIN command below. It was recorded during this recap. No interactive run was verified for that command.

```powershell
.\.venv-gru\Scripts\python.exe scripts/compare_landmarks.py --batches --raw-frames --label AGAIN
```

[Retraining and viewer work note](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining) · [All 32 signs and 108 archives by participant](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-17%20Participant%20mapping%20for%20the%2032%20signs)

- The user corrected the hardware provenance. The 21–30 FPS results came from a Ryzen 5 5600G, and the IdeaPad Ryzen 5 3500U observation is 9–17 FPS, typically 10–14. Reviewed Gemini's diagnosis and prioritized measuring model time and scheduling on the laptop. Confirmed that 640 px changes detector input while retaining the camera preview stream.
- The user authorized removing worker inference and using Hands + pose only in the Lab, then comparing Original with 640 px and repeating after several minutes. Implemented and verified the build and 317 tests. The four live runs remain pending because the available browser controls could not reach the local camera preview. See [[2026-11-17 Recognition Lab FPS Plan#Main-thread implementation and IdeaPad comparison]].

- The user observed around 14–15 live FPS with the landmark benchmark recording and around 10 after stopping. Checked both Nov 17 exports and traced Start and Stop. Both 640 × 360 runs recorded 12.77 and 13.34 processed FPS with about 28.6 presented FPS. The live metric continues across the toggle. The benchmark-only overlay paint probe adds two animation-frame callbacks. A matched OFF/ON comparison is needed to check whether those callbacks affect scheduling. Recorded findings in [[2026-11-17 Recognition Lab FPS Plan#Benchmark toggle FPS observation · 2026-11-17]]. No runtime edits made.

- The user repeated the FPS toggle test. Checked two Original-resolution exports at 11.47 and 12.28 processed FPS and confirmed that the report's active flag is set to false by Stop before export. Recorded the two runs and identified the benchmark-only paint timing callbacks as the next candidate to isolate.

- After reproducing smoother hand movement and higher FPS during four benchmark toggles, the user asked to apply that behavior during normal use while keeping the benchmark intact. Enabled its existing overlay timing callbacks for Recognition Lab Camera. Production build and eight focused tests passed. FPS and smoothness still need confirmation on the IdeaPad. See [[2026-11-17 Recognition Lab FPS Plan#Overlay timing in normal Lab use]].

- The user shared post-update evidence of 14.2 processed FPS in normal IdeaPad preview with landmark detection active and benchmark and recognition stopped. Logged the reading in [[2026-11-17 Recognition Lab FPS Plan#Overlay timing in normal Lab use]].

- Explained the distinction between benchmark recording, the rolling FPS readout, and the double-animation-frame overlay timing used in both normal Lab preview and benchmark mode. The 14.2 FPS screenshot documents post-update preview throughput. A causal browser scheduling trace is still unavailable.

- The user observed roughly 14 FPS while waving and a short dip after a hand re-enters. Verified the Lab still runs hand and pose on every scheduled frame. MediaPipe 0.10.35 can rerun palm detection when fewer than the configured two hand regions are tracked. That helps explain visibility-dependent cost and provides a re-entry hypothesis. The reason for a moving-versus-still difference at the same tracked count remains open. Logged the controlled test in [[2026-11-17 Recognition Lab FPS Plan#Hand visibility and motion · 2026-11-17]].

- Saved the proposed fresh-hand FPS and p95 gap fields for the active-recognition export in [[2026-11-17 Recognition Lab FPS Plan#Proposed active-recognition timing report]].

## 2026-11-17–18 — Recognition Lab camera performance and viewer review

- Reviewed four initial and seven follow-up landmark exports. Paired serial inference dominated callback processing. The follow-up runs also showed substantial between-callback gaps, including about 29 ms in Pose only. The reported 16 FPS peaks at both input sizes were rolling readings. The paired export averages were 13.28 FPS at Original and 11.89 FPS at 640 px. Separate recordings gave inconsistent resolution rankings. See [[2026-11-17 Recognition Lab FPS Plan#First benchmarks with the Landmark mode selector · 2026-11-18]].
- Added Hands only and Pose only alongside Hands + pose. Verified the settings, detector selection and benchmark metadata with frontend tests and a build. Proposed a same-source resolution comparison after finding that Lab Video always sent Original input at the time of review. The user chose to focus on Camera and use the uploaded benchmarks.
- Committed and pushed the earlier Recognition Lab work, skeleton landmark colors and other staged project changes across all four branches. Verified remote commits `NF d3d6dce`, `main a3b9a96`, `pipeline eb347f1` and `ui-ux da53af2`. Local Obsidian settings were outside the commits.
- Subsequent local Camera work added an early video-frame callback and latest-bitmap handoff with disposal and timestamp guards, isolated the status timer, coalesced snapshots at 125 ms, and added a pose-wrist filter. Added pose every fourth processed frame, shoulder EMA at 0.5, preview-only idle gating, and two initialized hand trackers with 9-fresh-pose downgrade and 3-fresh-pose upgrade hysteresis. See [[2026-11-17 Recognition Lab FPS Plan#Live camera scheduling and React rendering · 2026-11-18]] through the following work-note entries for implementation and checks.
- Added 1,333 ms wall-clock resampling for full Lab Camera windows with 40 steps at 30 Hz. Kept real observations for gesture logic and the native span for short gestures. The production build, 324 frontend tests, and 13 targeted backend tests passed. The full backend suite stalled at a WebSocket routing test. Phase 2 frame-drop augmentation remains planned. No new landmark benchmark was recorded, and hardware performance and live recognition quality remain unverified. See [[2026-11-17 Recognition Lab FPS Plan#Wall-clock recognition windows · 2026-11-18]].
- Restored the Lab Camera HandLandmarker thresholds in `visionRuntime.ts` after finding them reverted to 0.50. Presence is 0.25, tracking 0.30, and palm detection 0.45. The last focused rerun passed three tests.
- Diagnosed a VS Code save conflict in `scripts/compare_landmarks.py`. At review time the disk copy matched `d3d6dce`, and its STUDENT raw-frame command loaded all three sample-1 archives headlessly. The disk copy now has separate local viewer edits. Those edits were left intact and should be distinguished from the version checked earlier. See [[2026-11-17 Landmark Viewer Playback]].
