# Cloudflare remote test

**What was asked**
How to test the whole system again from another device with Cloudflare tunnels.

**What changed**
- Pointed to the "Test from another network" section of [[README]] (`scripts/remote-test.ps1`).
- First run stopped because a Python process (PID 16316, the backend) was on port 8000.
- Second run failed in `Wait-ProcessLog` with "Cannot index into a null array" (`$Matches[0]`).
- Fixed `scripts/remote-test.ps1`: the log is now cast to `[string]` and matched with `[regex]::Match`, so `$Matches` is no longer needed. A log file that doesn't exist yet no longer throws.

**Decisions and caveats**
- The user runs the script. Claude did not start any servers.

**Not done / open**
- The fix has not been checked with a real tunnel run yet.
