import { z } from "zod";

/**
 * Pure part of the update check: reading GitHub's "latest release" answer
 * and comparing versions. Kept free of Electron so it can be unit-tested.
 */

export const RELEASE_REPOSITORY = "JanisKre/DealerShipRiskMappingApp";
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${RELEASE_REPOSITORY}/releases`;

const GithubReleaseSchema = z.object({
  tag_name: z.string().max(100),
  html_url: z.string().max(500).optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

type Version = readonly [number, number, number];

/** `v1.2.3` / `1.2.3` → [1, 2, 3]; anything else (incl. pre-releases) → null. */
export function parseVersion(raw: string): Version | null {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export interface ReleaseCheck {
  latestVersion: string;
  available: boolean;
  /** Always a page of this repository's releases, never a remote-chosen URL. */
  releaseUrl: string;
}

/**
 * Evaluates the GitHub API response. Returns null for drafts, pre-releases
 * and tags that are no plain version, so they are never offered.
 */
export function evaluateLatestRelease(
  currentVersion: string,
  body: unknown,
): ReleaseCheck | null {
  const parsed = GithubReleaseSchema.safeParse(body);
  if (!parsed.success) return null;
  const release = parsed.data;
  if (release.draft || release.prerelease) return null;
  const version = parseVersion(release.tag_name);
  if (!version) return null;
  const latestVersion = version.join(".");
  const tagPage = `${RELEASES_PAGE}/tag/v${latestVersion}`;
  return {
    latestVersion,
    available: isNewerVersion(latestVersion, currentVersion),
    releaseUrl: release.html_url === tagPage ? release.html_url : tagPage,
  };
}
