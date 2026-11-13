import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileLogger,
  LOG_FILE_NAME,
  ROTATED_LOG_FILE_NAME,
  redactSecrets,
} from "./log.service";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drm-log-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("redactSecrets", () => {
  it("masks provider keys, tokens and authorization headers", () => {
    const line = redactSecrets(
      'key sk-ant-api03-abcdefghijkl, hf_ABCDEFGHIJKLMN, Authorization: Bearer eyJhbGciOi.payload x-api-key="sk-proj-12345678"',
    );
    expect(line).not.toMatch(/abcdefghijkl|ABCDEFGHIJKLMN|eyJhbGciOi|12345678/);
    expect(line).toContain("[redacted");
  });

  it("masks credentials in URLs and query parameters", () => {
    const line = redactSecrets(
      "GET https://user:pa55@proxy.example/x?api_key=secret123&lat=50.1",
    );
    expect(line).toBe(
      "GET https://[redacted]@proxy.example/x?api_key=[redacted]&lat=50.1",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Analysed 12 locations in 3.2 s (hail zone 2)";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("FileLogger", () => {
  const now = (): Date => new Date("2026-11-13T10:00:00.000Z");

  it("writes timestamped, redacted lines and creates the folder", () => {
    const dir = join(tempDir(), "logs");
    const logger = new FileLogger(dir, 1024 * 1024, now);
    logger.write("error", [
      "Provider failed:",
      new Error("bad key sk-abcdefghijk"),
    ]);
    const text = readFileSync(join(dir, LOG_FILE_NAME), "utf-8");
    expect(
      text.startsWith(
        "2026-11-13T10:00:00.000Z [error] Provider failed: Error: bad key [redacted-key]",
      ),
    ).toBe(true);
  });

  it("rotates at the size limit and keeps one previous file", () => {
    const dir = tempDir();
    const logger = new FileLogger(dir, 200, now);
    for (let i = 0; i < 20; i++)
      logger.write("info", [`line ${i} ${"x".repeat(20)}`]);
    expect(existsSync(join(dir, ROTATED_LOG_FILE_NAME))).toBe(true);
    expect(
      readFileSync(join(dir, LOG_FILE_NAME), "utf-8").length,
    ).toBeLessThanOrEqual(200);
    // The tail spans both files and ends with the newest line.
    const tail = logger.tail(10_000);
    expect(tail.trimEnd().endsWith(`line 19 ${"x".repeat(20)}`)).toBe(true);
  });

  it("returns only whole lines when the tail is cut", () => {
    const dir = tempDir();
    const logger = new FileLogger(dir, 1024 * 1024, now);
    for (let i = 0; i < 10; i++) logger.write("info", [`entry ${i}`]);
    const tail = logger.tail(80);
    expect(tail.split("\n")[0]).toMatch(
      /^2026-11-13T10:00:00.000Z \[info\] entry \d$/,
    );
  });
});
