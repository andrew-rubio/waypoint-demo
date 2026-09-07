/**
 * Public API for @waypoint/governance — the clean interface a future shared package or
 * central control-selection service would expose. Consumers should import only from here.
 */
export * from './types.js';
export { canonicalise, canonicalJson, sha256Of, sha256OfBytes } from './canonical.js';
export { loadCatalogue, loadProposition } from './catalog.js';
export { selectControls } from './select.js';
export { buildControlContract, contractHashOf } from './contract.js';
export { buildApprovalRecord, checkApproval, type ApproveOptions, type ApprovalCheck } from './approval.js';
export { verifyRelease, type VerifyOptions } from './verify.js';
export { releaseDecisionMarkdown, evidenceSummaryMarkdown } from './summary.js';
