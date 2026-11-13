import { describe, it, expect } from "vitest";
import { asksForWeb } from "../../src/lumo-client/web-intent.js";
import { Role, type Turn } from "../../src/lumo-client/types.js";

const user = (content: string): Turn => ({ role: Role.User, content });
const asst = (content: string): Turn => ({ role: Role.Assistant, content });

describe("asksForWeb", () => {
  it("detects requests for online / current information", () => {
    for (const text of [
      "cherche sur internet la doc de ox_lib",
      "fais une recherche web sur FiveM onesync",
      "quelle est la dernière version de Node ?",
      "what is the weather in Paris",
      "quelle est la météo demain",
      "prix du bitcoin",
      "search the web for vite 7 release notes",
      "google this error",
    ]) {
      expect(asksForWeb([user(text)]), text).toBe(true);
    }
  });

  it("ignores ordinary coding requests", () => {
    for (const text of [
      "relance ano_properties puis ano_burglary",
      "corrige le stock de l'inventaire",
      "ajoute le module crypto pour hasher les mots de passe",
      "le serveur web plante au démarrage",
      "lance les tests aujourd'hui",
    ]) {
      expect(asksForWeb([user(text)]), text).toBe(false);
    }
  });

  it("looks at the last real user message, not tool results", () => {
    expect(
      asksForWeb([
        user("cherche sur internet la doc de ox_lib"),
        asst("```json\n{}\n```"),
        user("[Tool Result: bash]\nweather.lua"),
      ]),
    ).toBe(true);
    expect(
      asksForWeb([
        user("cherche sur internet la doc de ox_lib"),
        asst("ok"),
        user("relance ano_burglary"),
        asst("```json\n{}\n```"),
        user("[Tool Result: bash]\nok"),
      ]),
    ).toBe(false);
  });

  it("ignores the post-compaction checkpoint OpenCode sends as a user turn", () => {
    const checkpoint =
      "## Objective\n- Mettre à jour ox_lib\n## Work State\n### Completed\n- (none)\n## Next Move\n1. Chercher sur internet la dernière version d'ox_lib";
    expect(asksForWeb([user(checkpoint)])).toBe(false);
  });

  it("never on title / compaction requests", () => {
    expect(
      asksForWeb(
        [user("cherche sur internet la doc")],
        "You are a title generator. You output ONLY a thread title.",
      ),
    ).toBe(false);
  });
});
