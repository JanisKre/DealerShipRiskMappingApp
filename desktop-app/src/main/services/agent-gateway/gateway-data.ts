import type { Session } from "@shared/types";

/** What the gateway routes read; injected so the routes are tested without a database. */
export interface GatewayData {
  listPortfolios(): Array<{
    id: string;
    name: string;
    updatedAt: string;
    snapshotOf?: string;
  }>;
  loadPortfolio(id: string): Session | null;
}

/**
 * The portfolio a request means: the given id, else the most recently
 * changed portfolio that is not a saved comparison state.
 */
export function resolvePortfolio(
  data: GatewayData,
  portfolioId: string | undefined,
): Session | null {
  if (portfolioId) return data.loadPortfolio(portfolioId);
  const latest = data.listPortfolios().find((p) => !p.snapshotOf);
  return latest ? data.loadPortfolio(latest.id) : null;
}
