import { cva, type VariantProps } from "class-variance-authority";
import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { cn } from "@renderer/lib/utils";

/**
 * One look for every message the app shows: the inline notices (map, pages,
 * dialogs) rendered with `Alert`, and the toasts (see ./sonner.tsx), which
 * take their surface, border and icon colour from the same tables.
 *
 * Anatomy: icon · title (medium) · description (small, muted) · actions.
 * The surface is opaque, so a notice also reads over aerial imagery. Only
 * the two tones that ask for attention (warning, destructive) tint it.
 */
export type NoticeTone =
  "neutral" | "info" | "success" | "warning" | "destructive";

/** Surface and border per tone. */
export const NOTICE_SURFACE: Record<NoticeTone, string> = {
  neutral: "border-border bg-card",
  info: "border-border bg-card",
  success: "border-border bg-card",
  warning:
    "border-warning/50 bg-[color-mix(in_oklab,var(--warning)_7%,var(--card))]",
  destructive:
    "border-destructive/50 bg-[color-mix(in_oklab,var(--destructive)_6%,var(--card))]",
};

/** Icon colour per tone; the text itself stays in the foreground colours. */
export const NOTICE_ICON_COLOR: Record<NoticeTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/** The icon a tone shows unless the notice names a more specific one. */
export const NOTICE_ICON: Record<NoticeTone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
};

/** Layout shared by inline notices and toasts. */
export const NOTICE_LAYOUT =
  "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-card-foreground";
export const NOTICE_TITLE = "font-medium leading-snug";
export const NOTICE_DESCRIPTION = "text-xs leading-snug text-muted-foreground";

const alertVariants = cva(cn(NOTICE_LAYOUT, "w-full"), {
  variants: {
    variant: NOTICE_SURFACE,
    /** Floating over a map or page instead of sitting in the page flow. */
    floating: { true: "shadow-lg", false: "" },
  },
  defaultVariants: { variant: "neutral", floating: false },
});

type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** Replaces the tone's icon; `null` shows none. */
    icon?: LucideIcon | null;
    /** A running step: a spinner in place of the icon. */
    busy?: boolean;
    /** Controls right of the text (a dismiss button, one short action). */
    aside?: React.ReactNode;
    /** False when a part inside announces itself (a ticking progress). */
    announce?: boolean;
  };

/**
 * Inline notice. Urgent ones (`destructive`) are announced at once, the rest
 * politely, unless the caller sets `role` itself.
 */
function Alert({
  className,
  variant,
  floating,
  icon,
  busy = false,
  aside,
  announce = true,
  role,
  children,
  ...props
}: AlertProps): React.JSX.Element {
  const tone: NoticeTone = variant ?? "neutral";
  const Icon = busy ? Loader2 : icon === undefined ? NOTICE_ICON[tone] : icon;
  return (
    <div
      data-slot="alert"
      role={
        role ??
        (announce ? (tone === "destructive" ? "alert" : "status") : undefined)
      }
      className={cn(alertVariants({ variant, floating }), className)}
      {...props}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            busy ? "animate-spin text-primary" : NOTICE_ICON_COLOR[tone],
          )}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
      {aside}
    </div>
  );
}

function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="alert-title"
      className={cn(NOTICE_TITLE, className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.JSX.Element {
  return (
    <p
      data-slot="alert-description"
      className={cn(NOTICE_DESCRIPTION, className)}
      {...props}
    />
  );
}

/** Row of actions under the text; buttons inside use `size="xs"`. */
function AlertActions({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="alert-actions"
      className={cn("flex flex-wrap gap-1.5 pt-0.5", className)}
      {...props}
    />
  );
}

export { Alert, AlertActions, AlertDescription, AlertTitle, alertVariants };
