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
import { type Localized, useLang } from "@/lib/i18n";
import {
  DOWNLOADS,
  detectPlatform,
  MAC_QUARANTINE_COMMAND,
  RELEASES_URL,
  sitePath,
} from "@/lib/site";

const T: Localized<{
  recommended: string;
  download: string;
  eyebrow: string;
  title: string;
  unsigned: string;
  releases: string;
}> = {
  en: {
    recommended: "Recommended",
    download: "Download",
    eyebrow: "Download",
    title: "Get the desktop app",
    unsigned: "Opening an unsigned build",
    releases: "All releases",
  },
  de: {
    recommended: "Empfohlen",
    download: "Download",
    eyebrow: "Download",
    title: "Desktop-App herunterladen",
    unsigned: "Unsignierten Build öffnen",
    releases: "Alle Releases",
  },
  fr: {
    recommended: "Recommandé",
    download: "Télécharger",
    eyebrow: "Téléchargement",
    title: "Obtenir l’application",
    unsigned: "Ouvrir une version non signée",
    releases: "Toutes les versions",
  },
};

/** One card per installer; the platform detected from the browser is highlighted. */
export function DownloadCards(): React.JSX.Element {
  const lang = useLang();
  const t = T[lang];
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
                {recommended && <Badge>{t.recommended}</Badge>}
              </div>
              <CardTitle className="mt-3 text-lg">
                {d.os} <span className="text-muted-foreground font-normal">· {d.label}</span>
              </CardTitle>
              <CardDescription>{d.detail[lang]}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                className="w-full"
                variant={recommended ? "default" : "outline"}
                asChild
              >
                <a href={d.href}>
                  <DownloadIcon />
                  {t.download}
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
  const t = T[useLang()];
  return (
    <Section id="download" eyebrow={t.eyebrow} title={t.title} className="bg-muted/40">
      <DownloadCards />
      <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <a
          href={sitePath("home", "installation", "#unsigned-builds")}
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          {t.unsigned} <ArrowRight className="size-3.5" />
        </a>
        <a href={RELEASES_URL} className="hover:text-foreground inline-flex items-center gap-1">
          {t.releases} <ArrowRight className="size-3.5" />
        </a>
      </div>
    </Section>
  );
}

const NOTES: Localized<{ mac: React.ReactNode; windows: React.ReactNode }> = {
  en: {
    mac: (
      <>
        Current macOS reports unsigned apps as{" "}
        <strong className="text-foreground">“damaged”</strong>, and right-click →
        Open no longer offers a bypass. Drag the app into{" "}
        <strong className="text-foreground">Applications</strong>, clear the
        quarantine flag in Terminal, then open it normally:
      </>
    ),
    windows: (
      <>
        SmartScreen may warn about an{" "}
        <strong className="text-foreground">“Unknown publisher”</strong>. Click{" "}
        <strong className="text-foreground">More info → Run anyway</strong>.
        Windows signing through the SignPath Foundation is being set up.
      </>
    ),
  },
  de: {
    mac: (
      <>
        Aktuelle macOS-Versionen melden unsignierte Apps als{" "}
        <strong className="text-foreground">„beschädigt“</strong>, und
        Rechtsklick → Öffnen hilft nicht mehr. Ziehe die App in den Ordner{" "}
        <strong className="text-foreground">Programme</strong>, entferne im
        Terminal das Quarantäne-Flag und öffne sie dann ganz normal:
      </>
    ),
    windows: (
      <>
        SmartScreen warnt eventuell vor einem{" "}
        <strong className="text-foreground">„Unbekannten Herausgeber“</strong>.
        Klicke auf{" "}
        <strong className="text-foreground">Weitere Informationen → Trotzdem ausführen</strong>.
        Die Windows-Signierung über die SignPath Foundation wird gerade
        eingerichtet.
      </>
    ),
  },
  fr: {
    mac: (
      <>
        Les versions récentes de macOS signalent les apps non signées comme{" "}
        <strong className="text-foreground">« endommagées »</strong>, et clic
        droit → Ouvrir ne permet plus de contourner l’alerte. Glissez l’app dans{" "}
        <strong className="text-foreground">Applications</strong>, supprimez
        l’attribut de quarantaine dans le Terminal, puis ouvrez-la normalement :
      </>
    ),
    windows: (
      <>
        SmartScreen peut afficher l’avertissement{" "}
        <strong className="text-foreground">« Éditeur inconnu »</strong>. Cliquez
        sur{" "}
        <strong className="text-foreground">Informations complémentaires → Exécuter quand même</strong>.
        La signature Windows via la SignPath Foundation est en cours de mise en
        place.
      </>
    ),
  },
};

export function UnsignedBuildNotes(): React.JSX.Element {
  const notes = NOTES[useLang()];
  const detected = detectPlatform(navigator.userAgent);

  return (
    <Tabs defaultValue={detected === "win-x64" ? "windows" : "macos"}>
      <TabsList>
        <TabsTrigger value="macos">macOS</TabsTrigger>
        <TabsTrigger value="windows">Windows</TabsTrigger>
      </TabsList>
      <TabsContent value="macos" className="mt-4 space-y-3">
        <p className="text-muted-foreground">{notes.mac}</p>
        <CodeBlock code={MAC_QUARANTINE_COMMAND} />
      </TabsContent>
      <TabsContent value="windows" className="mt-4">
        <p className="text-muted-foreground">{notes.windows}</p>
      </TabsContent>
    </Tabs>
  );
}
