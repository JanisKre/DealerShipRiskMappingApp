import { useEffect, useState } from "react";
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

/** Measured on the M4 Air: ~1.5 min per epoch for ~70 sites, plus ~8 min for measuring and new suggestions. */
const MIN_PER_EPOCH = 1.5;
const FIXED_MIN = 8;

const STEPS = [
  "Datensatz aus allen kompletten Standorten bauen",
  "Feintunen ab dem Basismodell",
  "Messen auf den 11 Validierungsstandorten (Ultralytics und App-Pipeline)",
  "Neue Vorschläge für die offenen Kacheln berechnen",
];

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
  const defaultBase = status.rounds.length
    ? status.rounds[status.rounds.length - 1].run
    : status.weights.includes("dealer-obb")
      ? "dealer-obb"
      : status.weights[0];
  const [base, setBase] = useState(defaultBase);
  const [epochs, setEpochs] = useState(15);
  const [pseudo, setPseudo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open)
      setBase(
        status.weights.includes(defaultBase) ? defaultBase : status.weights[0],
      );
  }, [open, defaultBase, status.weights]);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.run("round", { base, epochs, pseudo });
      toast.success("Runde gestartet. Du kannst weiter labeln.");
      onOpenChange(false);
      onStarted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Speichern &amp; neu trainieren</DialogTitle>
          <DialogDescription>
            Deine Kacheln sind schon gespeichert. Die Runde läuft im
            Hintergrund, etwa {Math.round(epochs * MIN_PER_EPOCH + FIXED_MIN)}{" "}
            Minuten. Lass den Mac am Ladegerät.
          </DialogDescription>
        </DialogHeader>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="round-base">Basismodell</Label>
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
            <Label htmlFor="round-epochs">Epochen</Label>
            <Input
              id="round-epochs"
              type="number"
              min={3}
              max={120}
              value={epochs}
              onChange={(e) => setEpochs(Number(e.target.value))}
            />
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
            Pseudo-Labels offener Standorte mittrainieren
            <span className="text-muted-foreground block text-xs">
              Aus lassen, solange du labelst: Ein Modell, das seine eigenen
              Vorschläge gelernt hat, ist bei genau diesen Kacheln zu
              selbstsicher.
            </span>
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">
          Installiert wird nichts. Ob das neue Modell besser ist, siehst du
          danach unter „Modelle“.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={busy || !base || epochs < 3}
            onClick={() => void start()}
          >
            Runde starten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
