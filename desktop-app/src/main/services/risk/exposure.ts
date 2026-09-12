import type { DetectionResult } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import {
  CAPACITY_SQM_PER_VEHICLE,
  VEHICLE_VALUE_DEFAULT_EUR,
  VEHICLE_VALUE_EUR,
} from "@shared/constants";

export function estimatedExposureEur(
  detection: DetectionResult | undefined,
  assetValue: number,
): number {
  if (detection?.manualVehicleCount != null) {
    return effectiveVehicleCount(detection) * VEHICLE_VALUE_EUR.car;
  }
  if (detection?.classCounts) {
    const c = detection.classCounts;
    const total = c.car + c.van + c.truck + c.bus;
    if (total > 0) {
      // Vehicle classes are intentionally not differentiated for
      // underwriting. The legacy fields remain readable for old sessions,
      // but every vehicle is valued as a car.
      return total * VEHICLE_VALUE_EUR.car;
    }
  }
  if (detection && detection.vehicleCount > 0) {
    return detection.vehicleCount * VEHICLE_VALUE_DEFAULT_EUR;
  }
  return assetValue;
}

export function capacityForArea(areaSqm: number): number {
  return areaSqm > 0 ? Math.max(1, areaSqm / CAPACITY_SQM_PER_VEHICLE) : 0;
}
