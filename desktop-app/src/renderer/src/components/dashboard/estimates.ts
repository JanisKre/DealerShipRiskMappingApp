/**
 * Estimate helpers live in `@shared/estimates` so the review rules
 * (`@shared/analytics`) use the same definition as the dashboard.
 */
export {
  type EstimateReason,
  estimateReasons,
  hasEalBasis,
  ealCoverage,
  estimatedExposure,
  ealSortValue,
} from "@shared/estimates";
