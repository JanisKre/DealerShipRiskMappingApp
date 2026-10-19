# Location search

The address field (start page omnibox and "Add location" in the locations
panel) finds dealerships and addresses. Everything runs in the main process
(`places.service.ts`). The search has four steps.

## 1. Understand the query (offline)

`place-query.ts` reads the typed text before any source is asked:

| Step | Example |
| --- | --- |
| Legal forms are dropped | "Autohaus Muster GmbH & Co. KG" → "Autohaus Muster" |
| Letters are folded: lower case, ä/ö/ü → ae/oe/ue, ß → ss, other accents dropped | "Müller" = "Mueller", "Škoda" = "Skoda" |
| A five-digit number is a postcode, a short number is a house number | "… 01067" is a place; "Ringweg 3" is an address |
| Kind words select Overture categories instead of matching names | "Motorradhändler", "Wohnmobil", "LKW", "Gebrauchtwagen", "Anhänger" |
| Brand spellings are aliases | "VW" ↔ "Volkswagen", "Mercedes" ↔ "Benz"/"Daimler" |
| A city or postcode is recognised from the Overture directory's own addresses | "Autohaus Müller **Dresden**" |

City recognition only looks at the last one to three words, and only when
something else is left to search for ("Dresden" alone stays a town search).
A query for a kind of dealer may be just the city ("Wohnmobil Hamburg"). The
city's position is the median of its dealers; a multi-word city is also found
by its first word ("Frankfurt" → the Frankfurt with the most dealers). Without
a downloaded directory this step is skipped and the query goes out unchanged.

Generic words ("Autohaus", "Auto", "Händler", "Center", …) say little about
which business is meant. They are not required to match once the query names
something more specific, so "Autohaus Müller" also finds "Müller Automobile".

## 2. Ask the sources

- **OpenStreetMap via Photon** (live): one query restricted to car dealers
  (`shop=car`) and one for everything. Photon is biased towards the city the
  query names, else the map view (city level at most), else Germany.
- **Overture Maps directory** (local, see [dealer-directory.md](./dealer-directory.md)):
  SQLite FTS5 prefix search over name, brand, street, postcode and city. Each
  word also matches the spellings the index may hold ("mueller" → "muller",
  "strasse" → "straße", "vw" → "volkswagen"). A named city limits the search
  to its area first and widens to all of Germany when nothing matches there.
  Free places in the list are filled with likely typos (letter-trigram
  similarity ≥ 0.6 on words of four letters or more). A query of only a kind
  and a place lists that kind's nearest dealers.

## 3. Merge

Hits for the same place are combined: the same OSM object, the same label
within 75 m, or — across OSM and Overture — a similar business name within
150 m. The OSM label is shown when both sources know a place, because it
usually carries the full address. The tag on the suggestion lists every
source ("OSM + Overture").

## 4. Rank

Every merged place gets one score (`place-ranking.ts`, `RANK_WEIGHTS`):

| Signal | Weight | Value |
| --- | --- | --- |
| Name match | 4 | Share of the identifying query words found in name or label (prefix = 1, typo = its similarity) |
| Kind | 1.5 | 1 for a dealer; for an address query (house number) 1 for an address with a house number |
| Confirmed | 0.75 | 1 when OSM and Overture both know the place |
| Named place | 1 | +1 inside the city (30 km) or postcode (8 km) area, −1 outside |
| In a portfolio | 1 | 1 when the place already is a saved portfolio location |
| Proximity | 0.5 | −log10(1 + km/10) from the named place, else the map view |
| Source order | −0.15 | Per position in the source's own list (capped at 5) |

The name match dominates, so a wrong name never wins on proximity. Equal
scores keep the order the sources returned, which makes the ranking
deterministic for the same inputs.

## Portfolio badge

A suggestion that already is a location in any saved portfolio (within 40 m,
or within 150 m with a similar name) shows "In portfolio: <name>" and the
first 90 characters of the location's note. Notes stay local: they are read
from the local database and are not sent to Photon, Overture or an LLM.

## Directory updates

Overture publishes a new release about once a month. Once a directory has
been downloaded, the app asks Overture's STAC catalog for the newest release
15 seconds after start, at most once every 24 hours, and remembers the
answer. A newer release is announced in Settings and under the search
results; the ~500 MB download itself only starts when the user clicks
"Refresh". Offline, the last known answer is kept.

## Limitations

- City recognition only knows places that have at least one Overture dealer,
  and a city name that is also part of a business name ("Autohaus Hof") is
  read as the city.
- Brand aliases and kind words are a fixed German/English list, not a
  language model; anything else is matched as typed.
- Photon receives the query as typed (minus legal forms); aliases and typo
  tolerance apply to the local directory and the ranking only.
- A hit is a candidate to pick, not a verified business register entry.
