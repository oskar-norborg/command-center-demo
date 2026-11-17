// Journal display helpers shared by the dossier and, with T4.1's journal page, #/journal.

/**
 * One journal entry as a line on the dossier (SPEC.md §3.4a, §3.4b): a trade shows units @ price, a hold its trigger
 * where a trade shows units @ price, and an opening entry `opening balance <units> @ <gav> (<date>)`.
 */
export function journalLine(j) {
  if (j.action === 'hold') return `${j.date} hold: ${j.trigger}`;
  if (j.action === 'opening') return `opening balance ${j.units} @ ${j.gav} ${j.currency} (${j.date})`;
  return `${j.date} ${j.action} ${j.units} @ ${j.price} ${j.currency}`;
}
