# Collector new sign labels

**What was asked**
Add 28 new signs to the collector page's sign label options.

**What changed**
- `Frontend/src/services/dataset/signLabelSearch.ts` (`SIGN_LABEL_GROUPS`):
  - Conversation and feedback: NOT_FINE, KNOW, DONT_KNOW, COMMUNICATION
  - People and family: HEARING, NAME, BOY, GIRL, MAN, WOMAN
  - Daily needs and actions: GO, COME, WANT, NEED, START, FINISH, OPEN, CLOSE, ENTER
  - New group "Directions": LEFT, RIGHT, UP, DOWN, NEAR, FAR, DIRECTION, EXIT
  - Numbers: NUMBER
- `npx tsc --noEmit` passed. Ran `graphify update .`.

**Decisions and caveats**
- DON'T_KNOW is stored as DONT_KNOW, matching DONT_UNDERSTAND (search ignores apostrophes).

**Not done / open**
- Not checked in the browser on the collector page.
