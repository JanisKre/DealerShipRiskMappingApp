import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { api, type Status } from "@studio/api";
import { roundBlocked, showError } from "@studio/lib";
import { duration, parseWhole, ROUND_EPOCHS } from "@studio/numbers";

/** Measured on the M4 Air: ~1.5 min per epoch for ~70 sites, plus ~8 min for measuring and new suggestions. */
const MIN_PER_EPOCH = 1.5;
const FIXED_MIN = 8;
export function RoundDialog({
  open,
  onOpenChange,
  status,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: Status;
  onStarted: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const defaultBase = status.rounds.length
    ? status.rounds[status.rounds.length - 1].run
    : status.weights.includes("dealer-obb")
      ? "dealer-obb"
      : status.weights[0];
  const [base, setBase] = useState(defaultBase);
  const [epochsText, setEpochsText] = useState("15");
  const epochs = parseWhole(epochsText, ROUND_EPOCHS.min, ROUND_EPOCHS.max);
  const blocked = roundBlocked(status);
  const valSites = status.dataset.valSites;
  const steps = [
    t("round.stepDataset"),
    t("round.stepFinetune"),
    valSites
      ? t("round.stepMeasure", { count: valSites })
      : t("round.stepMeasureAny"),
    // studio.py skips the suggestion step once every tile is finished
    ...(status.sites.checkedTiles < status.sites.tiles
      ? [t("round.stepSuggest")]
      : []),
  ];
  const [pseudo, setPseudo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open)
      setBase(
        status.weights.includes(defaultBase) ? defaultBase : status.weights[0],
      );
  }, [open, defaultBase, status.weights]);

  const start = async (): Promise<void> => {
    if (epochs == null || blocked) return;
    setBusy(true);
    try {
      await api.run("round", { base, epochs, pseudo });
      toast.success(t("round.started"));
      onOpenChange(false);
      onStarted();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("round.title")}</DialogTitle>
          <DialogDescription>
            {t("round.description", { count: status.finishedSites })}
            {epochs != null && (
              <>
                {" "}
                <span className="text-foreground">
                  {t("round.duration", {
                    duration: duration(epochs * MIN_PER_EPOCH + FIXED_MIN),
                  })}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="round-base">{t("round.base")}</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="round-base" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {status.weights.map((w) => (
                  <SelectItem key={w} value={w}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="round-epochs">{t("round.epochs")}</Label>
            <Input
              id="round-epochs"
              type="number"
              inputMode="numeric"
              min={ROUND_EPOCHS.min}
              max={ROUND_EPOCHS.max}
              value={epochsText}
              aria-invalid={epochs == null}
              aria-describedby="round-epochs-hint"
              onChange={(e) => setEpochsText(e.target.value)}
            />
            <p
              id="round-epochs-hint"
              className={
                epochs == null
                  ? "text-destructive text-xs"
                  : "text-muted-foreground text-xs"
              }
            >
              {t("round.epochsHint", {
                min: ROUND_EPOCHS.min,
                max: ROUND_EPOCHS.max,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="round-pseudo"
            checked={pseudo}
            onCheckedChange={setPseudo}
          />
          <Label
            htmlFor="round-pseudo"
            className="block text-sm leading-snug font-normal"
          >
            {t("round.pseudo")}
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {t("round.pseudoHint")}
            </span>
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("round.nothingInstalled")}
        </p>
        {blocked && (
          <p role="alert" className="text-destructive text-sm">
            {blocked}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !base || epochs == null || Boolean(blocked)}
            onClick={() => void start()}
          >
            {t("round.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
