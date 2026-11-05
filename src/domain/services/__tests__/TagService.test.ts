import { describe, expect, it } from "vitest";
import {
  extractTagsFromText,
  normalizeTag,
  TAG_REGEX,
  validateTag,
} from "../TagService";

describe("TagService unicode tags (#236)", () => {
  it("extracts uppercase ASCII tags lowercased", () => {
    expect(extractTagsFromText("Gym #Strength")).toEqual(["strength"]);
  });

  it("keeps accents and the full tag text", () => {
    expect(extractTagsFromText("corrida #saúde")).toEqual(["saúde"]);
    expect(extractTagsFromText("corrida #Saúde")).toEqual(["saúde"]);
    expect(normalizeTag("#Saúde")).toBe("saúde");
  });

  it("TAG_REGEX strips the whole tag from the name", () => {
    expect("corrida #saúde".replace(TAG_REGEX, "").trim()).toBe("corrida");
    expect("Gym #Strength".replace(TAG_REGEX, "").trim()).toBe("Gym");
  });

  it("validates unicode letters, rejects symbols", () => {
    expect(validateTag("saúde")).toBe(true);
    expect(validateTag("sa_de")).toBe(false);
  });
});
