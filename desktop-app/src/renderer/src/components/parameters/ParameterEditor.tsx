import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
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
import { parseLocaleNumber } from "./parameterInput";
import { type ParameterField, readableValue } from "./parameterFields";

/** One editable parameter, the reset dialog and the collapsible group. */

type ParameterEditorProps = {
  field: ParameterField;
  label: string;
  unit: string;
  value: string;
  /** UI language: the field reads and shows numbers in its notation. */
  locale: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  /** Receives the raw field text so an empty field isn't read as 0. */
  onCommit: (raw: string) => void;
  /** Escape: drop the draft and show the stored value again. */
  onRevert: () => void;
  /** Narrow table cell: smaller minimum width, no readable-value line. */
  compact?: boolean;
  /** Why the typed value was not taken; shown under the field. */
  error?: string;
};

export function ParameterEditor({
  field,
  label,
  unit,
  value,
  locale,
  disabled,
  onDraftChange,
  onCommit,
  onRevert,
  compact = false,
  error,
}: ParameterEditorProps): React.JSX.Element {
  const errorId = `parameter-${field.key}-error`;
  const readable = compact
    ? null
    : readableValue(field, parseLocaleNumber(value, locale));
  // Unit as an in-field suffix with its own width: units range from
  // "€" to "Schläge/km²/Jahr", so a fixed right padding can't fit them.
  return (
    <div className="space-y-0.5">
      <div
        className={`flex h-8 w-full items-center rounded-md border border-input shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring has-[input:read-only]:opacity-60 ${
          compact ? "min-w-14" : "min-w-24"
        }`}
      >
        <Input
          id={`parameter-${field.key}`}
          aria-label={label}
          // Text, not type="number": Chromium reads "30.000" as 30 there.
          type="text"
          inputMode={field.integer ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={() => onCommit(value)}
          onKeyDown={(event) => {
            // Enter commits and keeps the focus; Escape discards the draft.
            if (event.key === "Enter") onCommit(value);
            if (event.key === "Escape") {
              event.preventDefault();
              onRevert();
            }
          }}
          // Read-only, not disabled, while scores recalculate: a disabled
          // field drops the focus right after Enter.
          readOnly={disabled}
          aria-busy={disabled || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-full min-w-0 flex-1 border-0 px-2 text-right tabular-nums shadow-none focus-visible:ring-0"
        />
        {unit && (
          <span className="shrink-0 whitespace-nowrap pr-2 text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        // Inline, at the field it belongs to (UW-29): toasts piled up and
        // could be read as belonging to another field.
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        readable && (
          <p className="pr-2 text-right text-xs text-muted-foreground tabular-nums">
            = {readable}
          </p>
        )
      )}
    </div>
  );
}

/** Confirms a reset that would overwrite values differing from the defaults. */
export function ResetDialog({
  open,
  changedCount,
  onOpenChange,
  onConfirm,
}: Readonly<{
  open: boolean;
  changedCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("parameters.resetConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("parameters.resetConfirmDescription", { count: changedCount })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <RotateCcw className="size-4" />
            {t("parameters.reset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NativeDetails({
  initiallyOpen,
  children,
}: {
  initiallyOpen?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const setRef = useCallback(
    (node: HTMLDetailsElement | null) => {
      if (node) node.open = initiallyOpen ?? false;
    },
    [initiallyOpen],
  );

  // `group` on <details>: its `open` attribute drives the chevron.
  return (
    <details ref={setRef} className="group">
      {children}
    </details>
  );
}
