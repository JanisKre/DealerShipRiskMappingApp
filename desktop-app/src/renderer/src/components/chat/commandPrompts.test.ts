import { describe, expect, it } from "vitest";
import de from "@renderer/locales/de.json";
import en from "@renderer/locales/en.json";
import { parseChatAction } from "@renderer/lib/chatAssist";

/**
 * Without an AI provider the chat only offers these chips, so each must be
 * a command the app runs itself — otherwise clicking it does nothing.
 */
describe.each([
  ["de", de],
  ["en", en],
])("offline command chips (%s)", (_lang, locale) => {
  const prompts = locale.chat.commandPrompts;
  const locations = [{ id: "a1", name: "Autohaus Beispiel" }];
  const fill = (text: string): string =>
    text.replace("{{name}}", "Autohaus Beispiel");

  it.each(Object.keys(prompts) as (keyof typeof prompts)[])(
    "%s is handled without the AI",
    (key) => {
      expect(parseChatAction(fill(prompts[key]), locations)).not.toBeNull();
    },
  );
});
