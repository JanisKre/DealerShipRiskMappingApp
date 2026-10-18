import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Snippet with a copy button. Shell lines get a `$` prompt unless `plain`;
 * lines starting with `#` are shown as comments.
 */
export function CodeBlock({
  code,
  plain = false,
  className,
}: {
  code: string;
  plain?: boolean;
  className?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied; the text stays selectable.
    }
  }

  return (
    <div
      className={cn(
        "bg-code text-code-foreground group relative rounded-lg border text-sm",
        className,
      )}
    >
      <pre className="overflow-x-auto p-4 pr-12 leading-relaxed">
        {code.split("\n").map((line, i) => (
          <div key={i}>
            {plain ? (
              line
            ) : line.startsWith("#") ? (
              <span className="text-white/45">{line}</span>
            ) : (
              <>
                <span className="text-white/40 select-none">$ </span>
                {line}
              </>
            )}
          </div>
        ))}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        className="absolute top-2 right-2 size-8 text-white/60 hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
