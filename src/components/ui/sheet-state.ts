/**
 * When the last sheet closed. A double tap on a sheet's Save closes the sheet with the first tap and lands
 * the second on whatever is under it (the tab bar, a tile); controls that navigate ignore a tap this soon.
 */
let closedAt = 0

export function markSheetClosed(): void {
  closedAt = Date.now()
}

/** True for a tap that arrives within `ms` of a sheet closing: the tail of a double tap, not a new intent. */
export function sheetJustClosed(ms = 350): boolean {
  return Date.now() - closedAt < ms
}
