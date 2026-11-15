import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";

/** What a confirmation asks: already translated texts. */
export interface ConfirmOptions {
  title: string;
  text: string;
  confirm: string;
  cancel?: string;
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

/**
 * Asks in the studio's own dialog (instead of the browser's confirm(), which
 * cannot be styled or translated). Resolves true on confirm, false on cancel,
 * Escape or a click outside. Needs <ConfirmHost/> mounted once (App.tsx).
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ ...options, resolve });
  });
}

export function ConfirmHost(): React.JSX.Element {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    show = (p) => {
      setPending((old) => {
        old?.resolve(false);
        return p;
      });
    };
    return () => {
      show = null;
    };
  }, []);
  const close = (ok: boolean): void => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {pending?.cancel ?? t("confirm.cancel")}
          </Button>
          <Button
            variant={pending?.destructive ? "destructive" : "default"}
            autoFocus
            onClick={() => close(true)}
          >
            {pending?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
