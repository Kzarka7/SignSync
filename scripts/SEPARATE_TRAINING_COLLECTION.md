# Resting and idle collection with existing signs

Dataset collector opens the original sign-recording workflow: choose a sign,
start recording, then stop or discard manually and export saved signs.
Its list and Clear all action cover sign samples only. Boundary evaluation is
the separate resting and idle-movement workflow described below.

Open Dataset Collector > Boundary evaluation. Reuse the existing sign recordings
for training. The separate Training collection screen and its new-sign tasks
have been removed. The Pilot evaluation and Existing recordings screens are
removed; previously saved data remains in browser storage.

Select Resting or Idle movements and start the camera. No batch or participant
setup is required. Progress and saved samples are grouped by category, including
previously saved batch recordings. Existing batch metadata is preserved; new
recordings omit participant and batch fields.

| Category | Checklist | Recording duration |
| --- | --- | --- |
| Resting | 10 hand/posture combinations, 3 takes each (30 total) | Manual, or optional 1s / 3s / 5s auto-save |
| Idle movements | 7 specific activities, 3 takes each (21 total) | Manual, or optional 1s / 3s / 5s auto-save |
| General idle | Unlimited natural non-signing activity | Manual, or optional 1s / 3s / 5s auto-save |

Signs, resting and idle movements start with Delay and Duration unselected.
Recording starts immediately and stops manually by default. Select 1s, 3s or
5s for either option; click the selected option again to deselect it.

The resting checklist and posture guides are retained. Idle movements includes
hair, clothing, scratching the face, shifting in a chair, reaching for an
object, moving hands onto/off the lap and repositioning arms. Adjust glasses
has been removed from new tasks; any previously saved clips remain available.
General idle uses the same IDLE_MOVEMENT label as the specific activities.
Its checklist button shows Unlimited takes, with no completion quota or saved
counter. Its saved clips still appear in the sample list and exports.

Click a checklist task, then Start recording. Resting and specific idle tasks
advance after three successful saves, skipping completed tasks and wrapping
to earlier gaps. General idle stays selected so it can be recorded repeatedly.
It does not fill another activity's quota and does not interrupt automatic
selection among the specific tasks. Starting each take remains manual.

Lists, exports and Clear all within Boundary evaluation apply only to the
selected category. JSON/ZIP exports keep category, taskId and taskTitle in training metadata,
plus any participant/batch fields already present on older recordings. Labels are REST and
IDLE_MOVEMENT; the sample list displays IDLE for idle movements. Filenames
include the category. Export regularly using each category's sample list.

Keep signer identities when combining existing signs and new non-sign clips.
A signer already included in sign training is not an unseen-signer test.
Separate recordings support training, but real mixed-sequence evaluation is
still needed before validating start/end detection. No models are retrained
or promoted by this collection change.
