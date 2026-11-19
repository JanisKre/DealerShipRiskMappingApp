import { Loader2, X } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { buttonVariants } from "@renderer/components/ui/button";
import {
  NOTICE_DESCRIPTION,
  NOTICE_ICON,
  NOTICE_LAYOUT,
  NOTICE_SURFACE,
  NOTICE_TITLE,
  type NoticeTone,
} from "@renderer/components/ui/alert";
import { cn } from "@renderer/lib/utils";

/** Icon colour per tone; the icon sits in sonner's [data-icon] wrapper. */
// Written out, so Tailwind finds the class names.
const ICON_TONE: Record<NoticeTone, string> = {
  neutral: "[&_[data-icon]]:text-muted-foreground",
  info: "[&_[data-icon]]:text-primary",
  success: "[&_[data-icon]]:text-success",
  warning: "[&_[data-icon]]:text-warning",
  destructive: "[&_[data-icon]]:text-destructive",
};

/** A toast in a tone: the surface of the inline notice, its icon coloured. */
function toastTone(name: NoticeTone): string {
  return cn(NOTICE_SURFACE[name], ICON_TONE[name]);
}

function icon(name: NoticeTone): React.JSX.Element {
  const Icon = NOTICE_ICON[name];
  return <Icon aria-hidden className="size-4" />;
}

/**
 * Toast container, rendered once per window. Toasts look like the inline
 * notices (ui/alert.tsx): same surface, border, icons and text sizes, an
 * action as an outline button, the close button inside on the right.
 * sonner's own styles and colours are switched off (`unstyled`).
 *
 * Raise toasts through `notify` (lib/notify.ts), which sets how long each
 * kind stays and keeps a repeated message from stacking.
 */
function Toaster({
  closeLabel,
  ...props
}: ToasterProps & {
  /** Accessible name of a toast's close button, in the UI language. */
  closeLabel: string;
}): React.JSX.Element {
  return (
    <Sonner
      className="toaster group"
      closeButton
      visibleToasts={3}
      gap={8}
      icons={{
        success: icon("success"),
        info: icon("info"),
        warning: icon("warning"),
        error: icon("destructive"),
        loading: (
          <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
        ),
        close: <X aria-hidden className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: closeLabel,
        classNames: {
          toast: cn(
            NOTICE_LAYOUT,
            "w-[var(--width)] pr-9 shadow-lg",
            // Collapsed toasts behind the front one show their edge only.
            "data-[expanded=false]:data-[front=false]:[&>*]:opacity-0",
            // sonner centres its loader absolutely: keep it inside the icon slot.
            "[&_[data-icon]]:relative [&_[data-icon]]:mt-0.5 [&_[data-icon]]:flex [&_[data-icon]]:size-4 [&_[data-icon]]:shrink-0 [&_[data-icon]]:items-center [&_[data-icon]]:justify-center",
          ),
          content: "min-w-0 flex-1 space-y-0.5",
          loader: "!static !transform-none flex [&[data-visible=false]]:hidden",
          title: NOTICE_TITLE,
          description: NOTICE_DESCRIPTION,
          default: toastTone("neutral"),
          info: toastTone("info"),
          success: toastTone("success"),
          warning: toastTone("warning"),
          error: toastTone("destructive"),
          loading: toastTone("neutral"),
          actionButton: cn(
            buttonVariants({ variant: "outline", size: "xs" }),
            "cursor-pointer self-center",
          ),
          cancelButton: cn(
            buttonVariants({ variant: "ghost", size: "xs" }),
            "cursor-pointer self-center",
          ),
          closeButton: cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "absolute right-1.5 top-1.5 size-6 cursor-pointer text-muted-foreground",
          ),
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
