import type { GamesResponse } from "../src/models/api";

/** Catalog served by the in-memory game service; mirrors the bundled Spider rules document. */
export const CATALOG: GamesResponse = {
  games: [
    {
      gameId: "spider-solitaire",
      name: "Spider Solitaire",
      description: "Build eight full suits from king down to ace.",
      path: "/spider",
      latestVersion: 1,
      players: { min: 1, max: 1 },
      options: [
        {
          name: "suits",
          type: "ENUM",
          values: [1, 2, 4],
          default: 1,
          labels: { "1": "one suit", "2": "two suits", "4": "four suits" },
        },
        {
          name: "dealStyle",
          type: "ENUM",
          values: ["MICROSOFT", "HOYLE"],
          default: "MICROSOFT",
          labels: { MICROSOFT: "standard deal", HOYLE: "Hoyle deal" },
        },
      ],
      source: "CORE",
    },
  ],
};
