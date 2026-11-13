import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@shared/types";
import {
  condenseHistory,
  deriveConversationTitle,
  isGreeting,
  linkifyLocations,
  parseChatAction,
  mentionsDashboard,
  parseDashboardIntent,
  stripLocationLinks,
} from "./chatAssist";

const LOCATIONS = [
  { id: "a", name: "Autohaus Dresden Reick" },
  { id: "b", name: "Autohaus Dresden" },
  { id: "c", name: "Autohaus Sinemus" },
];

describe("linkifyLocations", () => {
  it("links each mentioned location, longest name first", () => {
    expect(
      linkifyLocations(
        "Autohaus Dresden Reick und Autohaus Dresden liegen nah.",
        LOCATIONS,
      ),
    ).toBe(
      "[Autohaus Dresden Reick](drm-location:a) und [Autohaus Dresden](drm-location:b) liegen nah.",
    );
  });

  it("keeps code and existing links untouched", () => {
    const text =
      "`Autohaus Sinemus` und [Autohaus Sinemus](https://x.de) aber Autohaus Sinemus";
    expect(linkifyLocations(text, LOCATIONS)).toBe(
      "`Autohaus Sinemus` und [Autohaus Sinemus](https://x.de) aber [Autohaus Sinemus](drm-location:c)",
    );
  });

  it("does not link inside longer words", () => {
    expect(
      linkifyLocations("Autohaus Sinemusweg", [
        { id: "c", name: "Autohaus Sinemus" },
      ]),
    ).toBe("Autohaus Sinemusweg");
  });
});

describe("stripLocationLinks", () => {
  it("restores the plain answer text for copying", () => {
    const text =
      "Autohaus Dresden Reick und `Autohaus Sinemus` [Doku](https://x.de)";
    const linked = linkifyLocations(text, LOCATIONS);
    expect(linked).not.toBe(text);
    expect(stripLocationLinks(linked)).toBe(text);
  });
});

describe("parseChatAction", () => {
  it("opens a location by name", () => {
    expect(parseChatAction("Öffne Autohaus Sinemus", LOCATIONS)).toEqual({
      type: "open",
      id: "c",
      name: "Autohaus Sinemus",
    });
  });

  it("shows a location on the map", () => {
    expect(
      parseChatAction("zeige Autohaus Dresden Reick auf der Karte", LOCATIONS),
    ).toMatchObject({ type: "showOnMap", id: "a" });
  });

  it("switches on map layers", () => {
    expect(
      parseChatAction("Zeige Kumulationen auf der Karte", LOCATIONS),
    ).toEqual({ type: "layer", layer: "accumulationClusters" });
    expect(parseChatAction("show hail zones", LOCATIONS)).toEqual({
      type: "layer",
      layer: "hailZones",
    });
  });

  it("exports reports", () => {
    expect(parseChatAction("Exportiere den PDF-Bericht", LOCATIONS)).toEqual({
      type: "export",
      format: "pdf",
    });
    expect(parseChatAction("export as xlsx", LOCATIONS)).toEqual({
      type: "export",
      format: "excel",
    });
  });

  it("leaves questions to the AI", () => {
    expect(parseChatAction("Wo gibt es Kumulationen?", LOCATIONS)).toBeNull();
    expect(parseChatAction("Öffne Autohaus Unbekannt", LOCATIONS)).toBeNull();
    expect(parseChatAction("", LOCATIONS)).toBeNull();
  });
});

describe("condenseHistory", () => {
  const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({
    role,
    content,
  });

  it("returns short conversations unchanged", () => {
    const messages = [msg("user", "a"), msg("assistant", "b")];
    expect(condenseHistory(messages, 20)).toEqual({
      recent: messages,
      note: null,
    });
  });

  it("condenses older turns and starts the recent part with a user turn", () => {
    const messages = [
      msg("user", "Frage 1"),
      msg("assistant", "Antwort 1"),
      msg("user", "Frage 2"),
      msg("assistant", "Antwort 2"),
      msg("user", "Frage 3"),
    ];
    const { recent, note } = condenseHistory(messages, 2);
    expect(recent[0]).toEqual(msg("user", "Frage 3"));
    expect(note).toBe(
      "User: Frage 1\nAssistant: Antwort 1\nUser: Frage 2\nAssistant: Antwort 2",
    );
  });
});

describe("conversation titles", () => {
  it("recognises greetings", () => {
    expect(isGreeting("Hallo!")).toBe(true);
    expect(isGreeting("Guten Tag")).toBe(true);
    expect(isGreeting("Welche Standorte sind kritisch?")).toBe(false);
  });

  it("skips greetings when naming a conversation", () => {
    expect(
      deriveConversationTitle(
        [
          { role: "user", content: "hallo" },
          { role: "assistant", content: "Hallo!" },
          { role: "user", content: "Welche Standorte treiben die Hagel-EAL?" },
        ],
        "new",
      ),
    ).toBe("Welche Standorte treiben die Hagel-EAL?");
  });

  it("falls back to the greeting, then to the fallback", () => {
    expect(
      deriveConversationTitle([{ role: "user", content: "hallo" }], "new"),
    ).toBe("hallo");
    expect(deriveConversationTitle([], "new")).toBe("new");
  });
});

describe("dashboard requests", () => {
  it("recognises building a new dashboard", () => {
    expect(
      parseDashboardIntent("Baue mir ein Dashboard zu Zone 4+", {
        canEdit: false,
      }),
    ).toEqual({ mode: "create" });
    expect(
      parseDashboardIntent("Erstelle eine Übersicht je Vertriebspartner", {
        canEdit: true,
      }),
    ).toEqual({ mode: "create" });
    expect(
      parseDashboardIntent("create a dashboard of new business", {
        canEdit: false,
      }),
    ).toEqual({ mode: "create" });
  });

  it("changes the shown dashboard, umlauts included", () => {
    expect(
      parseDashboardIntent("Füge eine Tabelle der Top 10 hinzu", {
        canEdit: true,
      }),
    ).toEqual({ mode: "edit" });
    expect(
      parseDashboardIntent("Ändere den Titel in Nordregion", { canEdit: true }),
    ).toEqual({ mode: "edit" });
    // Without a dashboard on screen there is nothing to change.
    expect(
      parseDashboardIntent("Füge eine Tabelle hinzu", { canEdit: false }),
    ).toBeNull();
    // "neues" asks for another dashboard, not a change.
    expect(
      parseDashboardIntent(
        "Erstelle ein neues Dashboard und füge eine Tabelle hinzu",
        { canEdit: true },
      ),
    ).toEqual({ mode: "create" });
  });

  it("leaves questions to the AI chat", () => {
    expect(
      parseDashboardIntent("Wie baue ich ein Dashboard?", { canEdit: true }),
    ).toBeNull();
    expect(
      parseDashboardIntent("Welche Standorte haben die höchste EAL", {
        canEdit: true,
      }),
    ).toBeNull();
  });

  it("returns the request as a chat action", () => {
    expect(parseChatAction(" Baue ein Dashboard für Nord ", [])).toEqual({
      type: "dashboard",
      mode: "create",
      prompt: "Baue ein Dashboard für Nord",
    });
  });
});

describe("changing the dashboard on screen", () => {
  it("treats imperative changes as edits, also without a widget word", () => {
    for (const prompt of [
      "Wechsle zu Hagelzone 2",
      "zu Hagelzone 2 wechseln",
      "Ändere auf Hagelzone 2",
      "Zeig stattdessen Hagelzone 2",
      "Stelle auf Vertriebspartner Nord um",
    ]) {
      expect(parseDashboardIntent(prompt, { canEdit: true })).toEqual({
        mode: "edit",
      });
    }
  });

  it("leaves those words alone when no dashboard is on screen", () => {
    expect(
      parseDashboardIntent("Wechsle zu Hagelzone 2", { canEdit: false }),
    ).toBeNull();
    expect(
      parseDashboardIntent("Entferne Autohaus Nord", { canEdit: false }),
    ).toBeNull();
  });

  it("knows when a message is about dashboards at all", () => {
    expect(mentionsDashboard("Kannst du das Dashboard für Zone 2 machen")).toBe(
      true,
    );
    expect(mentionsDashboard("Welche Standorte liegen in Zone 2")).toBe(false);
  });
});
