import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Switch } from "@renderer/components/ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import {
  CONFIDENCE_BANDS,
  DEFAULT_DETECTION_DISPLAY,
  DETECTION_COLOR_MODES,
  DETECTION_DOT_SIZES,
  DETECTION_SHAPES,
  detectionColor,
  DOT_RADIUS,
  type DetectionDisplay,
} from "@renderer/lib/detectionDisplay";
import { useMapStore } from "@renderer/store/mapStore";
import { SettingRow } from "./SettingRow";

/** Three parked cars in the chosen style, one per confidence band. */
function Preview({
  display,
}: Readonly<{ display: DetectionDisplay }>): React.JSX.Element {
  const cars = CONFIDENCE_BANDS.map((band, i) => ({
    x: 34 + i * 46,
    angle: [-8, 0, 12][i],
    score: band.min + 0.05,
  }));
  const radius = DOT_RADIUS[display.dotSize];
  return (
    <svg
      viewBox="0 0 160 56"
      className="h-14 w-40 shrink-0 rounded-md border bg-neutral-700"
      aria-hidden
    >
      {cars.map((car) => {
        const color = detectionColor(display.color, car.score);
        const box = display.shape !== "dot";
        const dot = display.shape !== "box";
        return (
          <g key={car.x} transform={`rotate(${car.angle} ${car.x} 28)`}>
            <rect
              x={car.x - 8}
              y={19}
              width={16}
              height={18}
              rx={3}
              fill="#d4d4d8"
              opacity={0.55}
            />
            {box && (
              <rect
                x={car.x - 9}
                y={18}
                width={18}
                height={20}
                fill={display.boxFill ? color : "none"}
                fillOpacity={0.12}
                stroke={color}
                strokeWidth={1.6}
              />
            )}
            {dot && (
              <circle
                cx={car.x}
                cy={28}
                r={box ? Math.min(2, radius) : radius}
                fill={color}
                fillOpacity={0.8}
                stroke={color}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * How detected vehicles look on the map. Stored with the other map view
 * choices on this device; the vehicle count and the EAL are unaffected.
 */
export function DetectionDisplayCard(): React.JSX.Element {
  const { t } = useTranslation();
  const display = useMapStore((s) => s.detectionDisplay);
  const setDisplay = useMapStore((s) => s.setDetectionDisplay);
  const isDefault = (
    Object.keys(DEFAULT_DETECTION_DISPLAY) as (keyof DetectionDisplay)[]
  ).every((key) => display[key] === DEFAULT_DETECTION_DISPLAY[key]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-base">
              {t("settings.detectionDisplay.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.detectionDisplay.description")}
            </CardDescription>
          </div>
          <Preview display={display} />
        </div>
      </CardHeader>
      <CardContent className="divide-y">
        <SettingRow
          label={t("settings.detectionDisplay.shape")}
          hint={t("settings.detectionDisplay.shapeHint")}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={display.shape}
            onValueChange={(v) =>
              v && setDisplay({ shape: v as DetectionDisplay["shape"] })
            }
          >
            {DETECTION_SHAPES.map((shape) => (
              <ToggleGroupItem
                key={shape}
                value={shape}
                className="flex-auto px-3"
              >
                {t(`settings.detectionDisplay.shapes.${shape}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          label={t("settings.detectionDisplay.color")}
          hint={t(
            display.color === "confidence"
              ? "settings.detectionDisplay.colorHintConfidence"
              : "settings.detectionDisplay.colorHint",
            {
              high: Math.round(CONFIDENCE_BANDS[0].min * 100),
              medium: Math.round(CONFIDENCE_BANDS[1].min * 100),
            },
          )}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={display.color}
            onValueChange={(v) =>
              v && setDisplay({ color: v as DetectionDisplay["color"] })
            }
          >
            {DETECTION_COLOR_MODES.map((mode) => (
              <ToggleGroupItem
                key={mode}
                value={mode}
                className="flex-auto px-3"
              >
                {t(`settings.detectionDisplay.colors.${mode}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          label={t("settings.detectionDisplay.dotSize")}
          hint={t("settings.detectionDisplay.dotSizeHint")}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={display.dotSize}
            disabled={display.shape !== "dot"}
            onValueChange={(v) =>
              v && setDisplay({ dotSize: v as DetectionDisplay["dotSize"] })
            }
          >
            {DETECTION_DOT_SIZES.map((size) => (
              <ToggleGroupItem
                key={size}
                value={size}
                className="flex-auto px-3"
              >
                {t(`settings.detectionDisplay.dotSizes.${size}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          label={t("settings.detectionDisplay.boxFill")}
          hint={t("settings.detectionDisplay.boxFillHint")}
          labelId="detection-box-fill-label"
        >
          <Switch
            aria-labelledby="detection-box-fill-label"
            checked={display.boxFill}
            disabled={display.shape === "dot"}
            onCheckedChange={(boxFill) => setDisplay({ boxFill })}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.detectionDisplay.onlySelected")}
          hint={t("settings.detectionDisplay.onlySelectedHint")}
          labelId="detection-only-selected-label"
        >
          <Switch
            aria-labelledby="detection-only-selected-label"
            checked={display.onlySelected}
            onCheckedChange={(onlySelected) => setDisplay({ onlySelected })}
          />
        </SettingRow>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <p className="text-xs text-muted-foreground">
            {t("settings.detectionDisplay.note")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isDefault}
            onClick={() => setDisplay(DEFAULT_DETECTION_DISPLAY)}
          >
            <RotateCcw className="size-4" />
            {t("settings.detectionDisplay.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
