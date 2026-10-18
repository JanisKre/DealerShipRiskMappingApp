import { cn } from "@/lib/utils";

export function Section({
  id,
  eyebrow,
  title,
  description,
  className,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} className={cn("border-b", className)}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="mb-10 max-w-2xl md:mb-12">
          <p className="text-primary mb-2 text-sm font-semibold tracking-wide uppercase">
            {eyebrow}
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground mt-4 text-lg text-pretty">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
