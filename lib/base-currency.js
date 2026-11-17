// The book's base currency, as a label for text (SPEC.md §3.1 `base_currency`). The real book is in NOK; the demo
// book is in USD (§5.11). Amount fields keep their `_nok` names everywhere: they hold the amount in the base
// currency, whatever it is. This module only answers "which three letters go after an amount".
//
// One setting per process or page, set once from portfolio.yaml before anything is rendered or written: the site
// sets it when its state loads (site/app/main.js), a scan when its state loads. It defaults to NOK, so code that
// never sets it behaves exactly as before. Shipped to dist/lib/, so it imports nothing.

let code = 'NOK';

/** Set the base currency from `portfolio.base_currency`. Anything but `USD` means NOK. */
export function setBaseCurrency(value) {
  code = value === 'USD' ? 'USD' : 'NOK';
  return code;
}

/** The base currency's code, for text after an amount: `NOK` or `USD`. */
export const ccy = () => code;

/** True when `currency` needs converting to the base (a USD position in a NOK book). */
export const isForeign = (currency, base = code) => currency !== base;

let labels = {};

/** Remember the accounts' display labels from portfolio.yaml, with the base currency: once, when the state loads. */
export function setAccounts(portfolio) {
  labels = {};
  for (const [id, account] of Object.entries(portfolio?.accounts ?? {})) {
    if (typeof account?.label === 'string' && account.label.trim()) labels[id] = account.label.trim();
  }
  return setBaseCurrency(portfolio?.base_currency);
}

/** An account's display name by id, from `setAccounts`: its label, else the id itself (`AF`, `ASK`). */
export const acct = (id) => labels[id] ?? id;

/** An account's display name: its optional `label` in portfolio.yaml, else its id (`AF`, `ASK`). */
export function accountLabel(portfolio, id) {
  const label = portfolio?.accounts?.[id]?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : id;
}
