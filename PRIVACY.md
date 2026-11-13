# Privacy policy

Dealership Risk Mapping is a local, single-user desktop application. It has no
backend operated by the maintainer, no user accounts, no analytics and no
telemetry. The maintainer does not receive any of your data.

## Data stored on your machine

Dealership lists, analysis results, imagery captures, the API cache and
settings are stored in the application's `userData` directory (SQLite
database and files). API keys are encrypted with the operating system's
keychain through Electron `safeStorage`.

The database itself is **not encrypted** by the app. Anyone who can read your
user account's files can read your portfolios, so keep full-disk encryption
switched on (FileVault on macOS, BitLocker or Device Encryption on Windows),
as most company devices require anyway.

A log file (`userData/logs/main.log`, rotated at 2 MB, at most two files)
records app events and errors for troubleshooting. API keys, tokens and
credentials in URLs are masked before a line is written. The log never leaves
your machine on its own: **Settings → General → App & support → Export
diagnostics** saves it, together with version numbers, your settings (without
API keys) and record counts, to a file you choose. Portfolios are not
included, but the log names the locations of analyses you ran. Review the file
before you pass it on.

**Settings → General → App & support → Delete all data** removes the
database (portfolios, chats, dashboards, settings, API keys, API cache,
dealer directory) with its backups, cached map data, the log files and the
browser storage, then restarts the app. Only the downloaded vehicle detection
model is kept, because it contains no user data. Deleting the `userData`
directory by hand has the same effect.

## Data sent to third parties

The app contacts external services only to perform the analysis you start.
Depending on the feature, a request can contain coordinates, addresses or
dealership names, and image tiles or captured images of a location. Those
services receive your IP address and are governed by their own privacy
policies.

| Purpose                                               | Services                                                                                | Data sent                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Geocoding                                             | Nominatim (OpenStreetMap), Photon (Komoot), state address services (ALKIS)              | Address or search text; street, house number and area of an address                                                                |
| Lot boundaries and buildings                          | Overpass API, state cadastre (ALKIS) services, LoD2 building tiles of the Bayerische Vermessungsverwaltung (bayernwolke.de) | Bounding box or coordinates; for Bayern only the name of the 2 km tile                                                             |
| Aerial and satellite imagery                          | Esri World Imagery, state orthophoto services, NASA HLS                                 | Tile coordinates and image requests around a location                                                                              |
| Basemaps and parcel overlay                           | Esri, OpenStreetMap, OpenTopoMap, basemap.de (BKG), state cadastre (ALKIS) map services | Tile coordinates or bounding boxes of the visible map                                                                              |
| Weather and hazard inputs                             | Open-Meteo                                                                              | Coordinates                                                                                                                        |
| Hail history (context only)                           | Deutscher Wetterdienst open data (`opendata.dwd.de`)                                    | Requests for the station list and the files of the nearest stations; no coordinates or addresses                                   |
| Dealer directory (when downloaded)                    | Overture Maps (STAC catalogue, public S3 bucket)                                        | Range requests for the places files; no search text or portfolio data                                                              |
| AI chat and memo (optional)                           | Anthropic, OpenAI or a custom provider URL you configure                                | Portfolio figures and location details (name, postcode and town, group, sales partner); never underwriting notes; your own API key |
| Detection model lookup (optional)                     | Hugging Face                                                                            | Model search queries                                                                                                               |
| Update check (can be switched off), model download    | GitHub (`api.github.com`, `github.com`, release downloads)                              | The app version in the user agent; nothing about your portfolios                                                                   |

The complete list of imagery sources is in
[docs/imagery-sources.md](./docs/imagery-sources.md). AI memos are only
generated when you configure a provider and request one; nothing is sent to an
AI provider otherwise. Packaged builds ask GitHub for a newer release at
start-up and once a day; switch this off under **Settings → General → App &
support** if your organisation rolls out versions itself; the detection model
is downloaded from the same release page only when you install it. Do not
import confidential customer data unless you are allowed to share it with the
services above.

## Contact

Questions about this policy: open an issue at
<https://github.com/JanisKre/DealerShipRiskMappingApp/issues>. Security reports
follow [SECURITY.md](./SECURITY.md).
