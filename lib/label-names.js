// The quote label strings and the exchange → calendar mapping, with no imports, so the browser can load them (shipped
// to dist/lib/ with lib/book.js, #91). lib/labels.js re-exports both: one definition.

/** The only four strings a quote label may ever be (schemas/scan.schema.json). */
export const LABELS = Object.freeze({
  CONFIRMED_CLOSE: 'confirmed close',
  INTRADAY: 'intraday print',
  UNCONFIRMED: 'last close, unconfirmed',
  FAILED: 'fetch failed',
});

/** The calendar an exchange trades on: OSE, or NYSE for both US exchanges. Throws on anything else (fail closed). */
export function calendarExchange(exchange) {
  if (exchange === 'OSE') return 'OSE';
  if (exchange === 'NYSE' || exchange === 'NASDAQ') return 'NYSE';
  throw new Error(`unknown exchange: ${exchange}`);
}
