import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";

/** App icon: the lucide radar on the brand-blue rounded square. */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-[22%] bg-[#3186e9] text-white",
        className,
      )}
    >
      <Radar className="size-[60%]" strokeWidth={2.25} />
    </span>
  );
}
