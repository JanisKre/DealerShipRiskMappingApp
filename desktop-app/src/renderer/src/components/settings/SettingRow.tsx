/** One labelled setting: label and hint on the left, the control on the right. */
export function SettingRow({
  label,
  hint,
  labelId,
  children,
}: Readonly<{
  label: string;
  hint: string;
  /** Lets a control without its own text name itself by the label. */
  labelId?: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium" id={labelId}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
