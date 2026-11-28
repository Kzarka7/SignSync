# Combined 74-sign model with composed PARENTS

**What was asked**
Combine 43 Similar Signs v1 and 32 Signs standalone v3 into one model. Drop PARENTS as a model output and instead turn FATHER + MOTHER (either order, back to back) into PARENTS, replacing the two printed signs. Avoid repeating the earlier "bad" combined model.

**What changed**
- Found the earlier failure's cause. 1,160 of 1,299 32-sign clips were saved with the hands swapped (video import). The 75-sign candidate scored 182/186 in its training hand order and 48/186 in the live camera order, and its route never swapped.
- New dataset and runs in `SignSync Dataset/experiments/samples_74_signs_combined_v1|v2|v3/`. Each clip is rebuilt in the live hand order, with REST/IDLE kept, PARENTS removed, and (v2/v3) FATHER/MOTHER parts cut from training PARENTS clips. Outputs are under `processed/candidates/` and `models/candidates/samples_74_signs_combined_v*`.
- Selected v3 (`models/candidates/samples_74_signs_combined_v3/.../REPORT.md`). Results: 43 signs 563/573 (v1 568), 31 signs 184/188 (v3 186), background false accepts 0/51 (v3 12/51), unseen P1/P4 signers 458/811 (v3 477). PARENTS composed on 10/12 seen-signer clips and 1/31 unseen. 0/89 single FATHER/MOTHER clips composed.
- App: `Backend/app/recognition.py` and `Backend/app/ws/translate.py` add route `lab-signs74-combined` (no hand swap, versioned ID). The frontend adds `composedSigns.ts`, composition in `recognitionDiagnostics.ts`, the Lab menu option, the predictor identity and the message type. Tests: `Frontend/tests/composedSigns.test.cjs`, an identity row in `diagnosticPredictor.test.cjs`, and a backend route test.
- Verified: real handler matched saved scores on 34 held-out requests, and a no-hands window returned IDLE. 95 frontend tests, the production build and 4 backend hand-slot tests passed. Ran `graphify update .`.
- Docs: dataset README Lab table, `Dataset Guide.md`, and `SignSync Dataset/documentation/2026-11-22 Combined 74 Signs Retraining.md`.

**Decisions and caveats**
- v3 misses two of five gates: the 31-sign test by one clip and unseen signers (458 vs 477). The combined model picks among 74 signs, v3 among 32.
- The v2 input noise hurt accuracy, so v3 keeps v1's model.
- 43 Similar Signs v1 stays the Lab default. Nothing was committed.

**Not done / open**
- No live camera trial yet of FATHER→MOTHER, MOTHER→FATHER, the singles, or confusable pairs.
- Reviewing and adding the unused P1/P4 archives to training (P1 DEAF needs label review first).

Related: [[Project Home]] · [[2026-11-19 Recognition Lab Live Accuracy Plan]]
