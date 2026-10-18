import { ArrowRight, Download as DownloadIcon, Laptop, Monitor } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DOWNLOADS,
  detectPlatform,
  MAC_QUARANTINE_COMMAND,
  RELEASES_URL,
  sitePath,
} from "@/lib/site";

/** One card per installer; the platform detected from the browser is highlighted. */
export function DownloadCards(): React.JSX.Element {
  const detected = detectPlatform(navigator.userAgent);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {DOWNLOADS.map((d) => {
        const Icon = d.os === "macOS" ? Laptop : Monitor;
        const recommended = d.platform === detected;
        return (
          <Card
            key={d.platform}
            className={recommended ? "border-primary ring-primary/20 ring-4" : undefined}
          >
            <CardHeader className="flex-1">
              <div className="flex items-center justify-between">
                <Icon className="text-muted-foreground size-6" />
                {recommended && <Badge>Recommended</Badge>}
              </div>
              <CardTitle className="mt-3 text-lg">
                {d.os} <span className="text-muted-foreground font-normal">· {d.label}</span>
              </CardTitle>
              <CardDescription>{d.detail}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                className="w-full"
                variant={recommended ? "default" : "outline"}
                asChild
              >
                <a href={d.href}>
                  <DownloadIcon />
                  Download
                </a>
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

export function Download(): React.JSX.Element {
  return (
    <Section
      id="download"
      eyebrow="Download"
      title="Get the desktop app"
      className="bg-muted/40"
    >
      <DownloadCards />
      <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <a
          href={sitePath("home", "installation", "#unsigned-builds")}
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          Opening an unsigned build <ArrowRight className="size-3.5" />
        </a>
        <a href={RELEASES_URL} className="hover:text-foreground inline-flex items-center gap-1">
          All releases <ArrowRight className="size-3.5" />
        </a>
      </div>
    </Section>
  );
}

export function UnsignedBuildNotes(): React.JSX.Element {
  const detected = detectPlatform(navigator.userAgent);

  return (
    <Tabs defaultValue={detected === "win-x64" ? "windows" : "macos"}>
      <TabsList>
        <TabsTrigger value="macos">macOS</TabsTrigger>
        <TabsTrigger value="windows">Windows</TabsTrigger>
      </TabsList>
      <TabsContent value="macos" className="mt-4 space-y-3">
        <p className="text-muted-foreground">
          Current macOS reports unsigned apps as{" "}
          <strong className="text-foreground">“damaged”</strong>, and right-click
          → Open no longer offers a bypass. Drag the app into{" "}
          <strong className="text-foreground">Applications</strong>, clear the
          quarantine flag in Terminal, then open it normally:
        </p>
        <CodeBlock code={MAC_QUARANTINE_COMMAND} />
      </TabsContent>
      <TabsContent value="windows" className="mt-4">
        <p className="text-muted-foreground">
          SmartScreen may warn about an{" "}
          <strong className="text-foreground">“Unknown publisher”</strong>. Click{" "}
          <strong className="text-foreground">More info → Run anyway</strong>.
          Windows signing through the SignPath Foundation is being set up.
        </p>
      </TabsContent>
    </Tabs>
  );
}
