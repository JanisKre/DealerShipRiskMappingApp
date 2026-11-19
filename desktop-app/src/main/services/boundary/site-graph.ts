import { projectPoint, ringAreaSqm, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import { addressBaseKeys, parcelStreets } from "./parcel-address";

/**
 * The parcels around a site as a graph: which parcels share how much border
 * and what lies on that border, which buildings stand across which lines,
 * which vehicles stand where. Everything the site model (`site-model.ts`)
 * asks about a parcel is answered from here, in metres, without another pass
 * over the geometry.
 *
 * Built once per site; all members are plain arrays indexed like `parcels`.
 */

type XY = [number, number];

/** Two outlines closer than this share a border (as `adjacentParcelM`). */
export const SHARED_BORDER_M = 3;
/** Outlines are sampled at this spacing when their shared length is measured. */
const BORDER_STEP_M = 2;
/** Vehicles this close stand in the same rows (as `vehicleLinkM`). */
export const VEHICLE_LINK_M = 12;
/** A row cluster this close to the point is part of the lot at the point. */
export const SEED_LOT_REACH_M = 40;
/** Vehicles this close to the chosen parcels stand "at" the site. */
export const NEAR_SITE_M = 25;
/** A building counts as standing on a parcel from this share of its area. */
export const BUILDING_ON_SHARE = 0.1;
/** … and from this area in square metres, whichever is larger. */
export const BUILDING_ON_SQM = 15;
/** Buildings below this are sheds; they tie nothing together. */
const MIN_BUILDING_SQM = 25;
/** A border sample this close to a footprint runs along its wall. */
const WALL_M = 1.5;
/** Offsets probed for vegetation around a border sample, in metres. */
const GREEN_PROBE: XY[] = [
  [0, 0],
  [1.5, 0],
  [-1.5, 0],
  [0, 1.5],
  [0, -1.5],
];
/** A border is judged by the image when at least this share of it is on it. */
const BORDER_SEEN_SHARE = 0.6;

export interface SiteBuilding {
  ring: LonLat[];
  areaSqm: number;
  /** Area of the footprint on each parcel it touches, by parcel index. */
  onParcel: Map<number, number>;
}

export interface SiteGraph {
  origin: LonLat;
  parcels: ParcelFeature[];
  /** Parcel outlines in metres from `origin`. */
  ringsXY: XY[][];
  /** Outline length of each parcel in metres. */
  perimeterM: number[];
  /**
   * `shared[i].get(j)`: metres of parcel i's outline that run within
   * `SHARED_BORDER_M` of parcel j.
   */
  shared: Array<Map<number, number>>;
  /** … of which on the image, so that vegetation is known. */
  sharedSeen: Array<Map<number, number>>;
  /** … of which vegetation on the image (a hedge, a verge, trees). */
  sharedGreen: Array<Map<number, number>>;
  /** … of which along or under a building (a wall on the line). */
  sharedBuilt: Array<Map<number, number>>;
  /** Vehicle positions in metres from `origin`. */
  vehicleXY: XY[];
  /** Vehicle indices standing on each parcel. */
  vehiclesOn: number[][];
  /** Parcel index of each vehicle, −1 off every parcel. */
  parcelOfVehicle: number[];
  /** Row cluster of each vehicle: vehicles chained by `VEHICLE_LINK_M`. */
  clusterOfVehicle: number[];
  buildings: SiteBuilding[];
  /** Built area on each parcel in square metres. */
  builtSqm: number[];
  /** Building indices with a real part on each parcel. */
  buildingsOn: number[][];
  /** Street-and-number keys of each parcel's address, letter suffixes dropped. */
  addressKeys: string[][];
  /** Street names in each parcel's address, numbered or not. */
  streets: string[][];
  /**
   * Share of each parcel that lies on the image the vehicles were detected
   * on; 1 everywhere when no image extent is known.
   */
  seenShare: number[];
}

function project(ring: LonLat[], origin: LonLat): XY[] {
  return ring.map((p) => projectPoint(p, origin));
}

function boundsOf(xy: XY[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of xy) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function pointInXY(ring: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToXY(ring: XY[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

export interface SiteGraphInput {
  anchor: LonLat;
  parcels: ParcelFeature[];
  /** Vehicle centres on the image; null when no detector ran. */
  vehicles: LonLat[] | null;
  buildings: LonLat[][];
  /** [west, south, east, north] of the image the vehicles were detected on. */
  imageBounds?: [number, number, number, number] | null;
  /** Vegetation on the image; null outside it (boundary/vegetation.ts). */
  vegetationAt?: (point: LonLat) => boolean | null;
}

export function buildSiteGraph(input: SiteGraphInput): SiteGraph {
  const origin = input.anchor;
  const parcels = input.parcels;
  const rings = parcels.map((parcel) => project(parcel.ring, origin));
  const boxes = rings.map(boundsOf);
  const near = (
    a: [number, number, number, number],
    b: [number, number, number, number],
    margin: number,
  ): boolean =>
    a[0] <= b[2] + margin &&
    b[0] <= a[2] + margin &&
    a[1] <= b[3] + margin &&
    b[1] <= a[3] + margin;

  const roofs = input.buildings
    .filter((ring) => ringAreaSqm(ring) >= MIN_BUILDING_SQM)
    .map((ring) => {
      const xy = project(ring, origin);
      return { xy, box: boundsOf(xy) };
    });
  const cosLat = Math.max(0.1, Math.cos((origin[1] * Math.PI) / 180));
  const toLonLat = (x: number, y: number): LonLat => [
    origin[0] + x / (111_320 * cosLat),
    origin[1] + y / 111_320,
  ];
  /** Vegetation at a border sample: the cell or one beside it; null unseen. */
  const greenAt = (x: number, y: number): boolean | null => {
    if (!input.vegetationAt) return null;
    let known = false;
    for (const [dx, dy] of GREEN_PROBE) {
      const value = input.vegetationAt(toLonLat(x + dx, y + dy));
      if (value == null) continue;
      known = true;
      if (value) return true;
    }
    return known ? false : null;
  };
  const builtAt = (x: number, y: number): boolean =>
    roofs.some(
      ({ xy, box }) =>
        x >= box[0] - WALL_M &&
        x <= box[2] + WALL_M &&
        y >= box[1] - WALL_M &&
        y <= box[3] + WALL_M &&
        (pointInXY(xy, x, y) || distanceToXY(xy, x, y) <= WALL_M),
    );

  // Shared border: every parcel's outline is walked once and each sample
  // credited to the parcels it runs along, with what the image and the
  // footprints show at that spot.
  const perimeterM = rings.map(() => 0);
  const shared: Array<Map<number, number>> = rings.map(() => new Map());
  const sharedSeen: Array<Map<number, number>> = rings.map(() => new Map());
  const sharedGreen: Array<Map<number, number>> = rings.map(() => new Map());
  const sharedBuilt: Array<Map<number, number>> = rings.map(() => new Map());
  const add = (map: Map<number, number>, key: number, value: number): void => {
    map.set(key, (map.get(key) ?? 0) + value);
  };
  for (let i = 0; i < rings.length; i += 1) {
    const candidates: number[] = [];
    for (let j = 0; j < rings.length; j += 1) {
      if (j !== i && near(boxes[i], boxes[j], SHARED_BORDER_M)) {
        candidates.push(j);
      }
    }
    const ring = rings[i];
    for (let k = 0; k + 1 < ring.length; k += 1) {
      const [x0, y0] = ring[k];
      const [x1, y1] = ring[k + 1];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length === 0) continue;
      perimeterM[i] += length;
      const steps = Math.max(1, Math.ceil(length / BORDER_STEP_M));
      const weight = length / steps;
      for (let s = 0; s < steps; s += 1) {
        const t = (s + 0.5) / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        // Read once per sample, and only where a neighbour runs along.
        let green: boolean | null | undefined;
        let built: boolean | undefined;
        for (const j of candidates) {
          const box = boxes[j];
          if (
            x < box[0] - SHARED_BORDER_M ||
            x > box[2] + SHARED_BORDER_M ||
            y < box[1] - SHARED_BORDER_M ||
            y > box[3] + SHARED_BORDER_M
          ) {
            continue;
          }
          if (distanceToXY(rings[j], x, y) > SHARED_BORDER_M) continue;
          add(shared[i], j, weight);
          if (built === undefined) built = builtAt(x, y);
          if (green === undefined) green = built ? false : greenAt(x, y);
          if (built) add(sharedBuilt[i], j, weight);
          if (green != null) {
            add(sharedSeen[i], j, weight);
            if (green) add(sharedGreen[i], j, weight);
          }
        }
      }
    }
  }

  const parcelAt = (x: number, y: number): number => {
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < rings.length; i += 1) {
      const box = boxes[i];
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
      // Overlapping parcels (a split parcel beside its whole): the smaller.
      if (parcels[i].areaSqm < bestArea && pointInXY(rings[i], x, y)) {
        best = i;
        bestArea = parcels[i].areaSqm;
      }
    }
    return best;
  };

  // Vehicles, and the rows they stand in (single linkage).
  const vehicleXY = (input.vehicles ?? []).map((v) => projectPoint(v, origin));
  const vehiclesOn: number[][] = rings.map(() => []);
  const parcelOfVehicle = vehicleXY.map(([x, y], index) => {
    const at = parcelAt(x, y);
    if (at >= 0) vehiclesOn[at].push(index);
    return at;
  });
  const cell = VEHICLE_LINK_M;
  const grid = new Map<string, number[]>();
  vehicleXY.forEach(([x, y], index) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });
  const linksOf = (index: number): number[] => {
    const [x, y] = vehicleXY[index];
    const links: number[] = [];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other === index) continue;
          const [ox, oy] = vehicleXY[other];
          if (Math.hypot(ox - x, oy - y) <= VEHICLE_LINK_M) links.push(other);
        }
      }
    }
    return links;
  };
  const clusterOfVehicle = vehicleXY.map(() => -1);
  let clusters = 0;
  for (let start = 0; start < vehicleXY.length; start += 1) {
    if (clusterOfVehicle[start] >= 0) continue;
    const stack = [start];
    clusterOfVehicle[start] = clusters;
    while (stack.length > 0) {
      for (const other of linksOf(stack.pop()!)) {
        if (clusterOfVehicle[other] >= 0) continue;
        clusterOfVehicle[other] = clusters;
        stack.push(other);
      }
    }
    clusters += 1;
  }

  // Buildings: the area of each footprint on each parcel, on a lattice.
  const builtSqm = rings.map(() => 0);
  const buildingsOn: number[][] = rings.map(() => []);
  const buildings: SiteBuilding[] = [];
  for (const ring of input.buildings) {
    const areaSqm = ringAreaSqm(ring);
    if (areaSqm < 1) continue;
    const xy = project(ring, origin);
    const [minX, minY, maxX, maxY] = boundsOf(xy);
    const step = Math.max(0.75, Math.sqrt(areaSqm / 150));
    const counts = new Map<number, number>();
    let total = 0;
    for (let y = minY + step / 2; y < maxY; y += step) {
      for (let x = minX + step / 2; x < maxX; x += step) {
        if (!pointInXY(xy, x, y)) continue;
        total += 1;
        const at = parcelAt(x, y);
        if (at >= 0) counts.set(at, (counts.get(at) ?? 0) + 1);
      }
    }
    if (total === 0) continue;
    const onParcel = new Map<number, number>();
    for (const [index, count] of counts) {
      const sqm = (count / total) * areaSqm;
      onParcel.set(index, sqm);
      builtSqm[index] += sqm;
    }
    const buildingIndex = buildings.length;
    buildings.push({ ring, areaSqm, onParcel });
    if (areaSqm < MIN_BUILDING_SQM) continue;
    for (const [index, sqm] of onParcel) {
      if (sqm >= Math.max(BUILDING_ON_SQM, BUILDING_ON_SHARE * areaSqm)) {
        buildingsOn[index].push(buildingIndex);
      }
    }
  }

  // Share of each parcel on the image.
  const image = input.imageBounds
    ? (() => {
        const [west, south, east, north] = input.imageBounds;
        const [x0, y0] = projectPoint([west, south], origin);
        const [x1, y1] = projectPoint([east, north], origin);
        return [x0, y0, x1, y1] as const;
      })()
    : null;
  const seenShare = rings.map((ring, i) => {
    if (!image) return 1;
    const [minX, minY, maxX, maxY] = boxes[i];
    if (
      minX >= image[0] &&
      maxX <= image[2] &&
      minY >= image[1] &&
      maxY <= image[3]
    ) {
      return 1;
    }
    if (
      maxX <= image[0] ||
      minX >= image[2] ||
      maxY <= image[1] ||
      minY >= image[3]
    ) {
      return 0;
    }
    const step = Math.max(2, Math.sqrt(parcels[i].areaSqm / 200));
    let total = 0;
    let seen = 0;
    for (let y = minY + step / 2; y < maxY; y += step) {
      for (let x = minX + step / 2; x < maxX; x += step) {
        if (!pointInXY(ring, x, y)) continue;
        total += 1;
        if (x >= image[0] && x <= image[2] && y >= image[1] && y <= image[3]) {
          seen += 1;
        }
      }
    }
    return total === 0 ? 0 : seen / total;
  });

  return {
    origin,
    parcels,
    ringsXY: rings,
    perimeterM,
    shared,
    sharedSeen,
    sharedGreen,
    sharedBuilt,
    vehicleXY,
    vehiclesOn,
    parcelOfVehicle,
    clusterOfVehicle,
    buildings,
    builtSqm,
    buildingsOn,
    addressKeys: parcels.map((parcel) => addressBaseKeys(parcel.address)),
    streets: parcels.map((parcel) => parcelStreets(parcel.address)),
    seenShare,
  };
}

/** What identifies the dealership in the cadastre: its house numbers. */
export interface SiteIdentity {
  /** Street-and-number keys, letter suffixes dropped. */
  keys: Set<string>;
  /** Streets of those keys and of the parcel at the point. */
  streets: Set<string>;
  /**
   * Row clusters of the lot at the point: those with a vehicle on the seed
   * parcel or within `SEED_LOT_REACH_M` of the point.
   */
  lotClusters: Set<number>;
}

/**
 * The identity of the site on parcel `seed`: the dealership's own address
 * and the address of the parcel.
 */
export function siteIdentity(
  graph: SiteGraph,
  seed: number,
  address?: string,
): SiteIdentity {
  const keys = new Set([
    ...addressBaseKeys(address),
    ...graph.addressKeys[seed],
  ]);
  const streets = new Set([
    ...[...keys].map((key) => key.split("|")[0]),
    ...graph.streets[seed],
  ]);
  const lotClusters = new Set<number>();
  for (const vehicle of graph.vehiclesOn[seed]) {
    lotClusters.add(graph.clusterOfVehicle[vehicle]);
  }
  graph.vehicleXY.forEach(([x, y], vehicle) => {
    // `origin` is the point the site is looked for at.
    if (Math.hypot(x, y) <= SEED_LOT_REACH_M) {
      lotClusters.add(graph.clusterOfVehicle[vehicle]);
    }
  });
  return { keys, streets, lotClusters };
}

/** What the model is told about one candidate parcel next to the chosen set. */
export interface ParcelEvidence {
  areaSqm: number;
  /** Candidate area over the area chosen so far. */
  areaRatio: number;
  /** Metres of border shared with the chosen parcels. */
  sharedM: number;
  /** Share of the candidate's outline that borders the chosen parcels. */
  borderOfParcel: number;
  /**
   * Metres of the shared border that are open ground on the image: no
   * vegetation and no wall on the line. Null when the image does not show
   * the border.
   */
  openBorderM: number | null;
  /** Share of the shared border that is vegetation; null unseen. */
  greenBorder: number | null;
  /** A building stands on the candidate and on a chosen parcel. */
  sharedBuilding: boolean;
  /** The candidate has a building of its own, on no chosen parcel. */
  ownBuilding: boolean;
  /** The chosen parcels carry no building yet, and the candidate does. */
  firstBuilding: boolean;
  /** Vehicles on the candidate. */
  vehicles: number;
  /** … per 1,000 m² of its unbuilt area. */
  density: number;
  /** Vehicles on the candidate within `NEAR_SITE_M` of a chosen parcel. */
  nearVehicles: number;
  /** … as a share of the candidate's vehicles. */
  nearShare: number;
  /** Vehicles on the chosen parcels. */
  siteVehicles: number;
  /**
   * Vehicles on the candidate that stand in the rows of the lot at the
   * point (`SiteIdentity.lotClusters`): the dealer's rows continue onto it.
   */
  lotVehicles: number;
  /**
   * "same": a house number of the site (letter suffixes aside); "other":
   * only other numbers; "street": no number, on a street of the site;
   * "none": no address, or a street the site is not on.
   */
  address: "same" | "other" | "street" | "none";
  /** Land-use shares, null where the cadastre publishes none. */
  landUse: ParcelFeature["landUse"] | null;
  /** Share of the candidate on the image the vehicles were counted on. */
  seenShare: number;
}

/** Unbuilt area of a parcel, never below a fifth of it. */
export function unbuiltSqm(graph: SiteGraph, index: number): number {
  const area = graph.parcels[index].areaSqm;
  return Math.max(area - graph.builtSqm[index], 0.2 * area);
}

/** Evidence about parcel `index` joining the parcels in `members`. */
export function parcelEvidence(
  graph: SiteGraph,
  members: ReadonlySet<number>,
  index: number,
  site: SiteIdentity,
): ParcelEvidence {
  const parcel = graph.parcels[index];
  let sharedM = 0;
  let seenM = 0;
  let greenM = 0;
  let builtM = 0;
  for (const [other, metres] of graph.shared[index]) {
    if (!members.has(other)) continue;
    sharedM += metres;
    seenM += graph.sharedSeen[index].get(other) ?? 0;
    greenM += graph.sharedGreen[index].get(other) ?? 0;
    builtM += graph.sharedBuilt[index].get(other) ?? 0;
  }
  const borderSeen = sharedM > 0 && seenM >= BORDER_SEEN_SHARE * sharedM;

  let siteArea = 0;
  let siteVehicles = 0;
  let siteBuilt = false;
  for (const member of members) {
    siteArea += graph.parcels[member].areaSqm;
    siteVehicles += graph.vehiclesOn[member].length;
    if (graph.buildingsOn[member].length > 0) siteBuilt = true;
  }
  const memberRings = [...members].map((member) => graph.ringsXY[member]);
  const own = graph.vehiclesOn[index];
  let nearVehicles = 0;
  let lotVehicles = 0;
  for (const vehicle of own) {
    if (site.lotClusters.has(graph.clusterOfVehicle[vehicle])) lotVehicles += 1;
    const [x, y] = graph.vehicleXY[vehicle];
    if (memberRings.some((ring) => distanceToXY(ring, x, y) <= NEAR_SITE_M)) {
      nearVehicles += 1;
    }
  }
  const sharedBuilding = graph.buildingsOn[index].some((building) =>
    [...graph.buildings[building].onParcel.keys()].some(
      (other) =>
        members.has(other) && graph.buildingsOn[other].includes(building),
    ),
  );
  const keys = graph.addressKeys[index];
  return {
    areaSqm: parcel.areaSqm,
    areaRatio: siteArea > 0 ? parcel.areaSqm / siteArea : 1,
    sharedM,
    borderOfParcel:
      graph.perimeterM[index] > 0
        ? Math.min(1, sharedM / graph.perimeterM[index])
        : 0,
    openBorderM: borderSeen ? Math.max(0, seenM - greenM - builtM) : null,
    greenBorder: borderSeen ? greenM / seenM : null,
    sharedBuilding,
    ownBuilding: graph.buildingsOn[index].length > 0 && !sharedBuilding,
    firstBuilding: !siteBuilt && graph.buildingsOn[index].length > 0,
    vehicles: own.length,
    density: (own.length / unbuiltSqm(graph, index)) * 1000,
    nearVehicles,
    nearShare: own.length > 0 ? nearVehicles / own.length : 0,
    siteVehicles,
    lotVehicles,
    address:
      keys.length === 0
        ? graph.streets[index].some((street) => site.streets.has(street))
          ? "street"
          : "none"
        : keys.some((key) => site.keys.has(key))
          ? "same"
          : "other",
    landUse: parcel.landUse ?? null,
    seenShare: graph.seenShare[index],
  };
}

/** Parcels sharing at least `minM` metres of border with a member. */
export function frontier(
  graph: SiteGraph,
  members: ReadonlySet<number>,
  minM = 1,
): number[] {
  const reach = new Map<number, number>();
  for (const member of members) {
    for (const [other, metres] of graph.shared[member]) {
      if (members.has(other)) continue;
      reach.set(other, (reach.get(other) ?? 0) + metres);
    }
  }
  return [...reach].filter(([, metres]) => metres >= minM).map(([i]) => i);
}

/** Vehicles standing on the given parcels. */
export function vehiclesOnParcels(
  graph: SiteGraph,
  members: Iterable<number>,
): number {
  let count = 0;
  for (const member of members) count += graph.vehiclesOn[member].length;
  return count;
}

/** Index of the smallest parcel containing the point, −1 when none does. */
export function parcelIndexAt(graph: SiteGraph, point: LonLat): number {
  const [x, y] = projectPoint(point, graph.origin);
  let best = -1;
  let bestArea = Infinity;
  graph.parcels.forEach((parcel, i) => {
    if (parcel.areaSqm >= bestArea) return;
    if (pointInXY(graph.ringsXY[i], x, y)) {
      best = i;
      bestArea = parcel.areaSqm;
    }
  });
  return best;
}
