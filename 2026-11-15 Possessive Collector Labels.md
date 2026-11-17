# 2026-11-15 Possessive Collector Labels

Add the six agreed possessive collection labels as their own group in the Sign Language Collector's sign picker. Show the English prompt with each option and keep the exact gloss label in saved samples. Set up a folder in the dataset vault's raw directory for the original recordings and exports.

Verify grouped display, search by gloss and prompt, and exact label selection with the existing picker tests. Run the frontend production build and check the raw folder path.

## Delivered

- The Sign Language Collector shows a **Possessives** group with `POSS-1` (My/Mine), `POSS-2` (Your/Yours (singular)), `POSS-3` (His/Her/Hers/Its), `POSS-1pl` (Our/Ours), `POSS-2pl` (Your/Yours (you all)), and `POSS-3pl` (Their/Theirs). Search accepts either gloss spelling or English prompt. The recorder receives the gloss label.
- The dataset vault now has [raw/possessives](../SignSync%20Dataset/raw/possessives/) for original downloads. Save exported files there using the browser download dialog or move them there after downloading. These are collection prompts pending linguistic review.
- All 23 targeted picker and recorder tests passed. The frontend production build succeeded, and the raw folder was verified on disk.

## Indexing Collector Labels · 2026-11-15

The user asked to add indexing to the same Collector. Add a distinct Indexing group for the three singular and three plural collection prompts. Verify the option text, search by label and prompt, and exact label selection.

The **Indexing** category now offers `IX-1` (I/Me), `IX-2` (You, singular), `IX-3` (That person), `IX-1pl` (We/Us), `IX-2pl` (You all), and `IX-3pl` (They/Them). The picker displays prompts and passes exact gloss labels to the recorder. All 24 targeted tests and the frontend production build passed.

### Collection design and Git delivery

- Use the same Collector picker for Indexing and Possessives, with separate categories. The singular and plural labels specify signer, addressee or third-party referents. Select by gloss or English prompt and store the exact gloss label.
- Pair indexing and possession prompts using the same people and object. Record referent and position for review. A distinct signed possessive form can receive a timed POSS annotation. If the phrase expresses possession as a whole, annotate it at that level. A fluent Deaf FSL signer should verify the forms.
- Pushed the Collector code and tests to all four branches and verified the remote tips. NF 1b4cc42, main 187fd1f, pipeline 77929c5 and ui-ux e74c477. The raw folder and vault notes were local.
