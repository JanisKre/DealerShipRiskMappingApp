import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, Trash2 } from "lucide-react";
import { notify } from "@renderer/lib/notify";
import {
  DEFAULT_TEMPLATE_ID,
  useParameterTemplates,
} from "@renderer/lib/useParameterTemplates";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { useAppStore } from "@renderer/store/appStore";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";

/** Saving, loading and deleting parameter templates. */

/** Apply a saved parameter set, or save the current values as one. */
export function TemplateControls({
  disabled,
}: Readonly<{ disabled: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const { templates, parametersOf, save, remove } = useParameterTemplates();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  async function apply(id: string): Promise<void> {
    const next = parametersOf(id);
    if (!next) return;
    const previous = parameters;
    await updateParameters(next);
    notify.success(
      t("parameters.templates.applied", {
        name:
          id === DEFAULT_TEMPLATE_ID ? t("parameters.templates.defaults") : id,
      }),
      {
        action: {
          label: t("parameters.resetUndo"),
          onClick: () => void updateParameters(previous),
        },
      },
    );
  }
  async function confirmSave(): Promise<void> {
    if (!name.trim()) return;
    try {
      await save(name, parameters);
      notify.success(t("parameters.templates.saved", { name: name.trim() }));
      setSaveOpen(false);
      setName("");
    } catch (error) {
      notify.failed(error, t("common.saveFailed"));
    }
  }
  return (
    <>
      <Select
        value=""
        onValueChange={(id) => void apply(id)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-9 w-52"
          aria-label={t("parameters.templates.apply")}
        >
          <SelectValue placeholder={t("parameters.templates.apply")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_TEMPLATE_ID}>
            {t("parameters.templates.defaults")}
          </SelectItem>
          {templates.map((tpl) => (
            <SelectItem key={tpl.name} value={tpl.name}>
              {tpl.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" onClick={() => setSaveOpen(true)}>
        <Save className="mr-2 size-4" />
        {t("parameters.templates.save")}
      </Button>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("parameters.templates.saveTitle")}</DialogTitle>
            <DialogDescription>
              {t("parameters.templates.saveDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="parameter-template-name">
              {t("parameters.templates.name")}
            </Label>
            <Input
              id="parameter-template-name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmSave();
              }}
            />
          </div>
          {templates.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {templates.map((tpl) => (
                <li
                  key={tpl.name}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => setName(tpl.name)}
                  >
                    {tpl.name}
                  </button>
                  <HintButton
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("parameters.templates.delete", {
                      name: tpl.name,
                    })}
                    onClick={() => void remove(tpl.name)}
                  >
                    <Trash2 className="size-3.5" />
                  </HintButton>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!name.trim()} onClick={() => void confirmSave()}>
              {t("parameters.templates.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
