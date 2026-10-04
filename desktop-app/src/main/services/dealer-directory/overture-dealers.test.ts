import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileMetaData } from "hyparquet";
import {
  bboxIntersects,
  discoverPlaceFiles,
  GERMANY_BBOX,
  isDealerPlace,
  rangeBuffer,
  rowGroupsInBbox,
  STAC_ROOT,
  toDealerRecord,
} from "./overture-dealers";

afterEach(() => {
  vi.restoreAllMocks();
});

const RELEASE = "2026-09-23.1";
const S3 = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/${RELEASE}/theme=places/type=place`;

function stacFixture(
  items: Array<{ bbox: number[]; href: string; size?: number }>,
): Record<string, unknown> {
  const base = `https://stac.overturemaps.org/${RELEASE}`;
  return {
    [STAC_ROOT]: {
      latest: RELEASE,
      links: [{ rel: "child", href: `${base}/catalog.json` }],
    },
    [`${base}/catalog.json`]: {
      links: [
        { rel: "child", title: "places", href: `${base}/places/catalog.json` },
      ],
    },
    [`${base}/places/catalog.json`]: {
      links: [
        {
          rel: "child",
          title: "place",
          href: `${base}/places/place/collection.json`,
        },
      ],
    },
    [`${base}/places/place/collection.json`]: {
      links: items.map((_, i) => ({
        rel: "item",
        href: `${base}/places/place/${i}.json`,
      })),
    },
    ...Object.fromEntries(
      items.map((item, i) => [
        `${base}/places/place/${i}.json`,
        {
          bbox: item.bbox,
          assets: { aws: { href: item.href, "file:size": item.size ?? 1_000 } },
        },
      ]),
    ),
  };
}

function fakeFetchJson(
  docs: Record<string, unknown>,
): (url: string) => Promise<unknown> {
  return async (url: string): Promise<unknown> => {
    if (!(url in docs)) throw new Error(`unexpected ${url}`);
    return docs[url];
  };
}

describe("discoverPlaceFiles", () => {
  it("returns the latest release and only files overlapping the bbox", async () => {
    const docs = stacFixture([
      {
        bbox: [6.28, 47.38, 42.14, 51.22],
        href: `${S3}/part-00010.parquet`,
        size: 7,
      },
      { bbox: [-120, 28, -77, 34], href: `${S3}/part-00002.parquet` },
    ]);

    const result = await discoverPlaceFiles(GERMANY_BBOX, fakeFetchJson(docs));

    expect(result).toEqual({
      release: RELEASE,
      files: [{ url: `${S3}/part-00010.parquet`, byteLength: 7 }],
    });
  });

  it("refuses data files on hosts other than the Overture bucket", async () => {
    const docs = stacFixture([
      { bbox: [6, 47, 15, 55], href: "https://evil.example/part.parquet" },
    ]);

    await expect(
      discoverPlaceFiles(GERMANY_BBOX, fakeFetchJson(docs)),
    ).rejects.toThrow(/Unexpected Overture host/);
  });
});

function metadata(
  groups: Array<{ rows: number; bbox?: [number, number, number, number] }>,
): FileMetaData {
  const column = (
    path: string,
    value: number,
    kind: "min" | "max",
  ): Record<string, unknown> => ({
    meta_data: {
      path_in_schema: path.split("."),
      statistics: kind === "min" ? { min_value: value } : { max_value: value },
    },
  });
  return {
    row_groups: groups.map((g) => ({
      num_rows: BigInt(g.rows),
      columns: g.bbox
        ? [
            column("bbox.xmin", g.bbox[0], "min"),
            column("bbox.ymin", g.bbox[1], "min"),
            column("bbox.xmax", g.bbox[2], "max"),
            column("bbox.ymax", g.bbox[3], "max"),
          ]
        : [],
    })),
  } as unknown as FileMetaData;
}

describe("rowGroupsInBbox", () => {
  it("keeps overlapping row groups with their absolute row ranges", () => {
    const md = metadata([
      { rows: 10, bbox: [20, 50, 25, 52] }, // Poland
      { rows: 5, bbox: [12, 51, 14, 52] }, // Saxony
      { rows: 8, bbox: [14.9, 54.9, 16, 56] }, // touches the corner
    ]);

    expect(rowGroupsInBbox(md, GERMANY_BBOX)).toEqual([
      { rowStart: 10, rowEnd: 15 },
      { rowStart: 15, rowEnd: 23 },
    ]);
  });

  it("reads a row group without statistics instead of dropping it", () => {
    expect(rowGroupsInBbox(metadata([{ rows: 3 }]), GERMANY_BBOX)).toEqual([
      { rowStart: 0, rowEnd: 3 },
    ]);
  });
});

describe("dealer filtering", () => {
  it.each([
    ["auto_dealer", "used_auto_dealer", true],
    ["vehicle_dealer", "truck_dealer", true],
    ["vehicle_dealer", "motorcycle_dealer", true],
    ["vehicle_dealer", "boat_dealer", false],
    ["vehicle_dealer", "forklift_dealer", false],
    ["automotive_service", "automotive_repair", false],
    [null, null, false],
  ])("%s / %s → %s", (basic, taxonomy, expected) => {
    expect(isDealerPlace(basic, taxonomy)).toBe(expected);
  });

  const row = {
    id: "08f1f-test",
    names: { primary: "Autohaus Muster" },
    basic_category: "auto_dealer",
    taxonomy: { primary: "auto_dealer" },
    brand: { names: { primary: "Volkswagen" } },
    addresses: [
      {
        freeform: "Industriestraße 12",
        locality: "Musterstadt",
        postcode: "01067",
        country: "DE",
      },
    ],
    bbox: { xmin: 13.7, ymin: 51.05 },
    confidence: 0.82,
    operating_status: "open",
  };

  it("maps a German dealer to a directory record", () => {
    expect(toDealerRecord(row)).toEqual({
      id: "08f1f-test",
      name: "Autohaus Muster",
      category: "auto_dealer",
      brand: "Volkswagen",
      street: "Industriestraße 12",
      postcode: "01067",
      city: "Musterstadt",
      lat: 51.05,
      lon: 13.7,
      confidence: 0.82,
    });
  });

  it.each([
    ["abroad (stated country)", { addresses: [{ country: "PL" }] }],
    ["outside the bbox", { bbox: { xmin: 21, ymin: 52 } }],
    ["permanently closed", { operating_status: "permanently_closed" }],
    ["low confidence", { confidence: 0.3 }],
    ["unnamed", { names: { primary: " " } }],
    ["another category", { basic_category: "restaurant" }],
  ])("drops a place that is %s", (_, patch) => {
    expect(toDealerRecord({ ...row, ...patch })).toBeNull();
  });

  it("keeps a dealer without operating status or address", () => {
    expect(
      toDealerRecord({ ...row, operating_status: null, addresses: null }),
    ).toMatchObject({ street: null, postcode: null, city: null });
  });
});

describe("rangeBuffer", () => {
  const file = { url: `${S3}/part.parquet`, byteLength: 100 };

  it("requests the exact byte range", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array(10), { status: 206 }));

    const buffer = await rangeBuffer(file).slice(90);

    expect(buffer.byteLength).toBe(10);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Range")).toBe("bytes=90-99");
  });

  it("rejects a server that ignores the range and sends the whole file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(100), { status: 200 }),
    );

    await expect(rangeBuffer(file).slice(0, 10)).rejects.toThrow(/range/);
  });
});

describe("bboxIntersects", () => {
  it("treats touching edges as overlapping", () => {
    expect(bboxIntersects([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(bboxIntersects([0, 0, 1, 1], [1.1, 0, 2, 1])).toBe(false);
  });
});
