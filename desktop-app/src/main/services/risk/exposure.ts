import type { DetectionResult } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";

export function estimatedExposureEur(
  detection: DetectionResult | undefined,
  assetValue: number,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): number {
  if (detection?.manualVehicleCount != null) {
    return effectiveVehicleCount(detection) * parameters.vehicleValueCarEur;
  }
  if (detection?.classCounts) {
    const c = detection.classCounts;
    const total = c.car + c.van + c.truck + c.bus;
    if (total > 0) {
      // Vehicle classes are intentionally not differentiated for
      // underwriting. The legacy fields remain readable for old sessions,
      // but every vehicle is valued as a car.
      return total * parameters.vehicleValueCarEur;
    }
  }
  if (detection && detection.vehicleCount > 0) {
    return detection.vehicleCount * parameters.vehicleValueDefaultEur;
  }
  return assetValue;
}

export function capacityForArea(
  areaSqm: number,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): number {
  return areaSqm > 0
    ? Math.max(1, areaSqm / parameters.capacitySqmPerVehicle)
    : 0;
}
