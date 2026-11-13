import type { TFunction } from "i18next";
import { DEFAULT_PORTFOLIO_NAME } from "@renderer/store/appStore";

/**
 * Display name of a portfolio: the store keeps an English sentinel for an
 * unnamed one, which is shown in the user's language instead.
 */
export function portfolioName(name: string, t: TFunction): string {
  return name === DEFAULT_PORTFOLIO_NAME
    ? t("shell.portfolioSwitcher.newPortfolio")
    : name;
}
