# Privacy policy

Dealership Risk Mapping is a local, single-user desktop application. It has no
backend operated by the maintainer, no user accounts, no analytics and no
telemetry. The maintainer does not receive any of your data.

## Data stored on your machine

Dealership lists, analysis results, imagery captures, the API cache and
settings are stored in the application's `userData` directory (SQLite
database and files). API keys are encrypted with the operating system's
keychain through Electron `safeStorage`. Deleting that directory removes all
stored data.

## Data sent to third parties

The app contacts external services only to perform the analysis you start.
Depending on the feature, a request can contain coordinates, addresses or
dealership names, and image tiles or captured images of a location. Those
services receive your IP address and are governed by their own privacy
policies.

| Purpose                           | Services                                                 | Data sent                                               |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Geocoding                         | Nominatim (OpenStreetMap), Photon (Komoot)               | Address or search text                                  |
| Lot boundaries and buildings      | Overpass API, Overture Maps                              | Bounding box or coordinates                             |
| Aerial and satellite imagery      | Esri World Imagery, state orthophoto services, NASA HLS  | Tile coordinates and image requests around a location   |
| Weather and hazard inputs         | Open-Meteo                                               | Coordinates                                             |
| AI underwriting memo (optional)   | Anthropic, OpenAI or a custom provider URL you configure | Analysis summary and location details; your own API key |
| Detection model lookup (optional) | Hugging Face                                             | Model search queries                                    |

The complete list of imagery sources is in
[docs/imagery-sources.md](./docs/imagery-sources.md). AI memos are only
generated when you configure a provider and request one; nothing is sent to an
AI provider otherwise. Do not import confidential customer data unless you are
allowed to share it with the services above.

## Contact

Questions about this policy: open an issue at
<https://github.com/JanisKre/DealerShipRiskMappingApp/issues>. Security reports
follow [SECURITY.md](./SECURITY.md).
