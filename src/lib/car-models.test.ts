import { describe, expect, test } from "bun:test";
import { CAR_MODELS, knownManufacturer, suggestManufacturers, suggestModels } from "./car-models";

describe("model suggestions", () => {
  test("a model leads to its manufacturer", () => {
    expect(suggestModels("logan", "")[0]).toEqual({ manufacturer: "Dacia", model: "Logan" });
    expect(suggestModels("octav", "")[0]).toEqual({ manufacturer: "Skoda", model: "Octavia" });
  });

  test("spaces, dashes and diacritics do not matter", () => {
    expect(suggestModels("c elysee", "")).toContainEqual({ manufacturer: "Citroën", model: "C-Elysee" });
    expect(suggestModels("model3", "")).toContainEqual({ manufacturer: "Tesla", model: "Model 3" });
  });

  test("a known manufacturer narrows the models", () => {
    const astra = suggestModels("a", "Opel");
    expect(astra.every((item) => item.manufacturer === "Opel")).toBe(true);
    expect(suggestModels("golf", "vw")).toEqual([
      { manufacturer: "Volkswagen", model: "Golf" },
      { manufacturer: "Volkswagen", model: "Golf Plus" },
      { manufacturer: "Volkswagen", model: "Golf Sportsvan" },
    ]);
  });

  test("an unknown manufacturer searches every model", () => {
    expect(suggestModels("clio", "Renaul")[0]).toEqual({ manufacturer: "Renault", model: "Clio" });
  });

  test("models starting with the text come first", () => {
    const found = suggestModels("ra", "");
    expect(found[0].model.toLowerCase().startsWith("ra")).toBe(true);
  });

  test("nothing typed suggests nothing", () => {
    expect(suggestModels("  ", "")).toEqual([]);
  });
});

describe("manufacturer suggestions", () => {
  test("common short names are understood", () => {
    expect(knownManufacturer("vw")).toBe("Volkswagen");
    expect(knownManufacturer("mercedes")).toBe("Mercedes-Benz");
    expect(knownManufacturer("citroen")).toBe("Citroën");
    expect(suggestManufacturers("mer")[0]).toBe("Mercedes-Benz");
  });

  test("the catalogue has no duplicate models per manufacturer", () => {
    for (const [name, models] of Object.entries(CAR_MODELS)) {
      expect(new Set(models).size, name).toBe(models.length);
    }
  });
});
