# Dealer directory (Overture Maps)

Location search combines two sources:

- **OpenStreetMap via Photon** (`places.service.ts`): live and keyless. It
  sends two queries per search: all places, and car dealerships only
  (`osm_tag=shop:car`).
- **Overture Maps places** (`dealer-directory.service.ts`): a local copy of the
  dealers in Germany, searched offline with SQLite FTS5.

OSM often lacks smaller businesses. Overture merges place data from Meta,
Microsoft, Foursquare and others, and fills many of those gaps.

## Download

Overture has no search API. It publishes GeoParquet files in a public S3
bucket. `overture-dealers.ts` reads only the parts it needs, using HTTP range
requests (hyparquet, pure JS):

1. `https://stac.overturemaps.org/catalog.json` names the latest release and
   each places file's bbox. Only the 4 of 16 files that overlap Germany are
   opened.
2. Each file's footer carries bbox statistics per row group. Only the row
   groups that overlap Germany are read.
3. Pass one reads only `basic_category`. Pass two reads id, name, taxonomy,
   brand, address, bbox, confidence and operating status, and only for row
   groups that contain dealers.

The download runs in a `utilityProcess`, because zstd decompression in JS is
CPU-bound. It reads about 500 MB and takes about 3–4 minutes on a typical
connection. The result is about 45,000 records, roughly 12 MB in the app
database. Each refresh replaces the whole table in one transaction. The
release id and retrieval time are stored with it.

## Filters

| Rule | Reason |
| --- | --- |
| `basic_category` = `auto_dealer` | New and used car dealers, brokers |
| `basic_category` = `vehicle_dealer` **and** taxonomy in {vehicle, truck, commercial vehicle, motorcycle, RV, trailer} dealer | Road vehicles parked outside like a car lot; excludes boats, forklifts, aircraft |
| `confidence` ≥ 0.5 | Lower scores are mostly stale or duplicate records |
| `operating_status` missing or `open` | Drops permanently closed businesses (about 2,400) |
| Inside Germany's bbox, and `country` = `DE` when an address is given | The bbox also clips corners of every neighbour |

Release 2026-09-23.1 produced 51,242 dealer places, of which 45,374 passed
the filters.

## Search and merge

- Every typed word is a prefix match on name, brand, street, postcode and
  city. Legal forms (GmbH, & Co. KG, …) are dropped first, because OSM and
  Overture names rarely carry them consistently.
- Ranking is bm25 (name weighted highest). It is nudged towards the visible
  map area and towards confident records.
- A business both sources know (within 150 m, similar name once generic words
  like "Autohaus" are ignored) is listed once, with the OSM entry kept. Each
  suggestion shows its source.

## Limitations

- Overture positions are point locations of the business. They are not a lot
  boundary; boundary detection still runs on the chosen point.
- Overture refreshes monthly. The local copy ages until the user refreshes it
  in Settings.
- Names come from aggregated commercial and crowd sources. A hit is a
  candidate for the user to pick, not a verified business register entry.

## Licence

Overture Maps Foundation, places theme: CDLA Permissive 2.0. Contains
Foursquare data (Apache 2.0): "Copyright 2024 Foursquare Labs, Inc. All rights
reserved." The attribution is shown in the settings card.
