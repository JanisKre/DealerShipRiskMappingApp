# Own Overpass server (optional)

OpenStreetMap data (buildings for the roof mask, the website lookup and OSM
dealer areas) comes from Overpass. The public servers are mostly at capacity,
so by default the app uses OSM only when it is already cached and never waits
for it.

With an own server the app asks it first and waits up to 3 s for an answer
in every analysis; the public servers stay the fallback. Without one,
everything keeps working online as before.

## Setting it up

1. Run an Overpass server with an extract of the regions you analyse, for
   example with Docker and the `wiktorn/overpass-api` image. Its README
   describes the variables; a Sachsen extract from Geofabrik looks like this:

   ```bash
   docker run -d --name overpass -p 12345:80 \
     -e OVERPASS_MODE=init \
     -e OVERPASS_META=no \
     -e OVERPASS_PLANET_URL=https://download.geofabrik.de/europe/germany/sachsen-latest.osm.bz2 \
     -e OVERPASS_DIFF_URL=https://download.geofabrik.de/europe/germany/sachsen-updates/ \
     -e OVERPASS_RULES_LOAD=10 \
     wiktorn/overpass-api
   ```

   The first start imports the extract and takes a while; a whole-Germany
   extract needs tens of gigabytes of disk.

2. In the app, open **Settings → OpenStreetMap data** and enter
   `http://localhost:12345/api/interpreter`.

Only HTTPS addresses, or plain HTTP on this machine (`localhost`,
`127.0.0.1`, `[::1]`), are accepted, without credentials, query string or
fragment (`shared/overpass-url.ts`). Clearing the field returns to the public
servers only.
