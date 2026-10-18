import { Download as DownloadIcon, ExternalLink, Laptop, Monitor } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
} from "@/lib/site";

export function Download(): React.JSX.Element {
  const detected = detectPlatform(navigator.userAgent);

  return (
    <Section
      id="download"
      eyebrow="Download"
      title="Get the desktop app"
      description="Installers are built from this repository by the tag-driven release workflow and ship with SHA-256 checksums, a CycloneDX SBOM and build provenance."
      className="bg-muted/40"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {DOWNLOADS.map((d) => {
          const Icon = d.os === "macOS" ? Laptop : Monitor;
          const recommended = d.platform === detected;
          return (
            <Card
              key={d.platform}
              className={recommended ? "border-primary ring-primary/20 ring-4" : undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Icon className="text-muted-foreground size-6" />
                  {recommended && <Badge>Recommended</Badge>}
                </div>
                <CardTitle className="mt-3 text-lg">
                  {d.os} <span className="text-muted-foreground font-normal">· {d.label}</span>
                </CardTitle>
                <CardDescription>{d.detail}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <code className="text-muted-foreground text-xs break-all">{d.file}</code>
              </CardContent>
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

      <p className="text-muted-foreground mt-4 text-sm">
        Linux: build an AppImage from source (see{" "}
        <a href="#build" className="text-foreground underline underline-offset-4">
          Build from source
        </a>
        ).{" "}
        <a
          href={RELEASES_URL}
          className="text-foreground inline-flex items-center gap-1 underline underline-offset-4"
        >
          All releases, checksums and SBOMs <ExternalLink className="size-3" />
        </a>
      </p>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Opening an unsigned build</CardTitle>
          <CardDescription>
            Builds are not code-signed yet (no paid developer certificate), so
            the operating system warns on first launch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={detected === "win-x64" ? "windows" : "macos"}>
            <TabsList>
              <TabsTrigger value="macos">macOS</TabsTrigger>
              <TabsTrigger value="windows">Windows</TabsTrigger>
            </TabsList>
            <TabsContent value="macos" className="mt-4 space-y-3 text-sm">
              <p className="text-muted-foreground">
                Current macOS reports unsigned apps as{" "}
                <strong className="text-foreground">“damaged”</strong>, and
                right-click → Open no longer offers a bypass. Drag the app into{" "}
                <strong className="text-foreground">Applications</strong>, clear
                the quarantine flag in Terminal, then open it normally:
              </p>
              <CodeBlock code={MAC_QUARANTINE_COMMAND} />
            </TabsContent>
            <TabsContent value="windows" className="mt-4 text-sm">
              <p className="text-muted-foreground">
                SmartScreen may warn about an{" "}
                <strong className="text-foreground">“Unknown publisher”</strong>.
                Click <strong className="text-foreground">More info → Run anyway</strong>.
                Windows signing through the SignPath Foundation is being set up.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </Section>
  );
}
