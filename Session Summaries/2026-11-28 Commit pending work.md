# Commit pending work

**What was asked**
Commit the pending changes in source control and explain where each commit went and why.

**What changed**
- Tests: frontend 386/386 passed after the fix. `tsc` passed. Backend `tests.test_diagnostic_recognition` ran 32 tests, all OK.
- Fixed `Frontend/tests/datasetRecorder.test.cjs`. It expected 113 labels; the 26-sign batch makes it 139.
- Commits on NF (pushed):
  - `7d4d526` test fix
  - `87b1301` Motion E promoted to live + 74-sign Motion E Lab candidates
  - `55e9131` scripts
  - `915c53b` mannequin model
  - `ccbaa08` docs and session summaries
- The test fix was also cherry-picked to main `17fced9`, pipeline `8f55037` and ui-ux `e0c511b`, then pushed.

**Decisions and caveats**
- The feature work went to NF only, not to the other branches.
- Not committed: `mannequin.blend1` (Blender autosave) and two `mannequin_backup_*.blend` files.

**Not done / open**
- Tests were not run on main, pipeline or ui-ux.
