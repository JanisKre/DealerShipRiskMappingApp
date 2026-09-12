import type { DetectionResult } from "@shared/types";
import {
  CAPACITY_SQM_PER_VEHICLE,
  VEHICLE_VALUE_DEFAULT_EUR,
  VEHICLE_VALUE_EUR,
} from "@shared/constants";

export function estimatedExposureEur(
  detection: DetectionResult | undefined,
  assetValue: number,
): number {
  if (detection?.classCounts) {
    const c = detection.classCounts;
    const total = c.car + c.van + c.truck + c.bus;
    if (total > 0) {
      return (
        c.car * VEHICLE_VALUE_EUR.car +
        c.van * VEHICLE_VALUE_EUR.van +
        c.truck * VEHICLE_VALUE_EUR.truck +
        c.bus * VEHICLE_VALUE_EUR.bus
      );
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
