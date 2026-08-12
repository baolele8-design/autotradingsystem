// A1-2: Frontend ledger resolve must not overwrite an exit_reason that the
// daemon reconcile already recorded on the row. The daemon's attribution
// (algo states / client-order prefixes) is more accurate than the UI's
// price-tolerance heuristic, so a stored reason wins and only a truly empty
// row is filled with the UI's precise reason.
export const decideExitReasonUpdate = (log, preciseExitReason) => {
  const stored = String(log?.exit_reason || '').trim();
  return stored ? log.exit_reason : preciseExitReason;
};
