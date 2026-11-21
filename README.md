# Command Center

A private investment command center: one screen that shows a portfolio's positions, the written reason for each,
the price levels that would make me act, and what changed since the last market close.

**This repository is the public demo. It shows a model portfolio, not my holdings.** The ten names are real US
companies and funds, and every price is a real daily close. The position sizes, average costs, cash, trades and
levels are made up. The real one runs on my own portfolio and stays private.

**[Open the live demo](https://oskar-norborg.github.io/command-center-demo/)** · last published with the closes of 20 Nov 2026

![The command view](screenshots/command.jpg)

## What it does

- **Checks every position against written levels.** Each holding has a level to trim at and a level that would make
  me re-examine the case for it. A scheduled scan after each close compares prices with those levels and reports
  what was hit and what is near.
- **Keeps the reasoning next to the position.** Each position page says why it is held, what has to go right, and
  what would break the case. Every trade is journaled with the reasoning at the time and graded later, once for the
  decision and once for the outcome.
- **Says how sure each number is.** A price is labelled a confirmed close, an intraday print, a last close not yet
  confirmed, or a failed fetch. Anything derived from a price that is not a confirmed close is marked ≈.
- **Never tells me to trade.** An alert names a level and the condition to check. It does not say buy or sell.

## What the demo shows

- A model book of about 12.5 million USD: six companies (AAPL, NVDA, AMZN, GOOGL, JPM, COST), four funds (VOO, QQQ,
  SCHD, BND) and cash, plus a watchlist of three candidates (HD, XOM, PG) with buy levels.
- The last sixty market closes, at real prices. Which levels are hit or near, and which positions are over their
  cap, is worked out from those prices by the same rules the private version uses. The levels themselves are model
  choices, re-set at the start of each quarter from that day's close.
- Charts drawn from the same closes: the book over time against its largest fund, the distance from each price to
  its levels, and each position's price against its levels.

Nothing in the demo is advice, and a model book's results say nothing about mine.

![A position page](screenshots/position.jpg)

## How it stays current

After each US market close a scheduled job in the private repository fetches the day's closing prices, rebuilds
this demo, checks it, and publishes the result here. The date at the top of the page is the date of the prices: if
the job has not run, the page shows an older date and says so, and the job reports a failure once the demo is two
sessions behind. The screenshots above are from one day and do not
update.

Prices are daily closes from Yahoo Finance. Fund values use the market close, and dividends are not counted. Earnings
dates, where shown, come from a calendar feed and are estimates.

## How it is built

- **Three parts.** State is a set of small YAML and Markdown files. A scan is a scheduled script that fetches prices
  and writes one JSON file per close. The site is a static build that reads both and only displays.
- **Every change to the state goes through a pull request** with automated checks, including one that refuses to
  let the record of a name I sold or turned down disappear.
- **No framework and no server.** Plain JavaScript modules, hand-written SVG charts, more than a thousand automated
  tests.
- **A leak check guards this demo.** Before anything is published, the build searches its own output for any ticker,
  name, holding, balance or line of text from the private book and refuses to publish if it finds one.

I wrote the specification and reviewed every change. The code was written with AI coding agents working from that
specification, one small task at a time.

## About this repository

It holds the built demo site only. The source lives in the private repository, and the publishing job there is the
only thing that writes here.
