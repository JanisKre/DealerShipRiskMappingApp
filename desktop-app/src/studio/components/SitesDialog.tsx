import { useState } from "react";
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
import { api } from "@studio/api";
import { showError } from "@studio/lib";
import { fmt } from "@studio/numbers";

/** Biggest file the studio accepts (studio.py MAX_BODY, with room for JSON escaping). */
const MAX_BYTES = 1_800_000;
const COUNT = { min: 5, max: 2000 } as const;
/** The columns select_sites.py reads (studio.py DEALER_COLUMNS). */
const COLUMNS =
  "ID, OSM ID, Latitude, Longitude, Federal State, Dealership Name, City";

/**
 * A fresh clone's first step: upload a dealer CSV (for example from
 * JanisKre/dealership_dataset); select_sites.py then writes data/sites.csv
 * as a job. Only the file's content is sent, never a path.
 */
export function SitesDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState("80");
  const [busy, setBusy] = useState(false);
  const n = Number(count);
  const countOk =
    count.trim() !== "" &&
    Number.isInteger(n) &&
    n >= COUNT.min &&
    n <= COUNT.max;
  const tooBig = Boolean(file && file.size > MAX_BYTES);

  const start = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const { rows } = await api.uploadDealers(await file.text());
      await api.run("sites", { count: n });
      toast.success(t("sites.started", { count: rows }));
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
          <DialogTitle>{t("sites.title")}</DialogTitle>
          <DialogDescription>{t("sites.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="sites-file">{t("sites.file")}</Label>
            <Input
              id="sites-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sites-count">{t("sites.count")}</Label>
            <Input
              id="sites-count"
              type="number"
              inputMode="numeric"
              min={COUNT.min}
              max={COUNT.max}
              value={count}
              aria-invalid={!countOk}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </div>
        <p
          className={
            tooBig || !countOk
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {tooBig
            ? t("sites.tooBig", { size: fmt(MAX_BYTES / 1e6, 1) })
            : !countOk
              ? t("sites.countInvalid", COUNT)
              : t("sites.columns", { columns: COLUMNS })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !file || !countOk || tooBig}
            title={!file ? t("sites.chooseFile") : undefined}
            onClick={() => void start()}
          >
            {t("sites.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
