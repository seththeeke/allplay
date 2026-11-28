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
      tiles: [
        {
          path: "/spider",
          name: "Spider Solitaire",
          description: "The easiest game: all spades.",
          options: { suits: 1, dealStyle: "MICROSOFT" },
        },
        {
          path: "/spider/two-suits",
          name: "Spider Solitaire: Two Suits",
          description: "Spades and hearts. Runs must match suit.",
          options: { suits: 2, dealStyle: "MICROSOFT" },
        },
        {
          path: "/spider/four-suits",
          name: "Spider Solitaire: Four Suits",
          description: "All four suits. The hardest game.",
          options: { suits: 4, dealStyle: "MICROSOFT" },
        },
      ],
    },
  ],
};
