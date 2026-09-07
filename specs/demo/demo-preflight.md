# Demo preflight

Run `npm run demo:preflight` (non-destructive; never prints secret values). It checks:
branch + clean tree, Node ≥ 22, dependencies installed, required env var **names** present,
no real payment/booking endpoint, local-driver vs Foundry mode clearly identified, governance
artefacts + eval fixtures present, and the backup recording path.

Exit code is non-zero on a hard failure. See `demo-runbook.md` for the presenter sequence and
`demo-recovery.md` for prerecorded fallbacks.
