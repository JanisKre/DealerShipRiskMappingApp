import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";

/** Confirmation dialog for permanently removing locations (list selection or one marker). */
export function DeleteSelectedDialog({
  open,
  count,
  name,
  onOpenChange,
  onConfirm,
}: Readonly<{
  open: boolean;
  count: number;
  /** Single location by name (map context menu) instead of a count. */
  name?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {name
              ? t("map.page.deleteConfirmTitle")
              : t("map.locationsPanel.deleteSelectedConfirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {name
              ? t("map.page.deleteConfirmDescription", { name })
              : t("map.locationsPanel.deleteSelectedConfirmDescription", {
                  count,
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 className="size-4" />
            {t("map.page.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
