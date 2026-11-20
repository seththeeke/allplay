import type { GameEvent, LegalAction, SessionEnvelope } from "../models/api";
import { GameSessionError } from "../service/gameSession/errors";
import type { GameSessionService } from "../service/gameSession/gameSessionService";
import { renderBoard } from "./board";

export const PLAYER = "LOCAL#cli";
const GAME = { gameId: "spider-solitaire", options: { suits: 1, dealStyle: "MICROSOFT" } };

export const HELP = [
  "Commands:",
  "  board, b            show the board",
  "  moves, m            list legal moves, numbered",
  "  <n>, move <n>       play move number n from the list",
  "  <from> <to>         move from one column to another, for example 3 7",
  "  move <actionId>     play an exact action id",
  "  deal, d             deal a row from the stock",
  "  hint, h             show a hint",
  "  undo, u             undo the last action",
  "  new                 abandon this game and start another",
  "  help, ?             show this list",
  "  quit, q             exit",
].join("\n");

export interface CommandResult {
  output: string;
  quit?: boolean;
}

export interface CliSession {
  start(): Promise<string>;
  handle(line: string): Promise<CommandResult>;
}

function listMoves(actions: LegalAction[]): string {
  if (actions.length === 0) return "No legal moves.";
  return actions.map((action, i) => `${String(i + 1).padStart(3)}. ${action.text}`).join("\n");
}

function eventLines(events: GameEvent[]): string[] {
  return events.flatMap((event) => (typeof event.speech === "string" ? [event.speech] : []));
}

/** The move from one numbered column to another; for an empty target, the largest movable unit. */
function columnMove(actions: LegalAction[], from: number, to: number): LegalAction | undefined {
  return actions
    .filter(
      (action) =>
        action.descriptor.kind === "MOVE_CARDS" &&
        action.descriptor.from.index === from &&
        action.descriptor.to.index === to,
    )
    .sort((a, b) => Number(b.params["depth"] ?? 0) - Number(a.params["depth"] ?? 0))[0];
}

/**
 * The command loop's logic (game-engine.md Addendum A.3). Every command goes
 * through the game session service; the client only matches input against
 * the server's legal actions.
 */
export function createCliSession(service: GameSessionService): CliSession {
  let current: SessionEnvelope | null = null;
  const envelope = (): SessionEnvelope => current as SessionEnvelope;

  const begin = async (): Promise<string> => {
    current = await service.start(PLAYER, GAME);
    return `New one-suit Spider Solitaire game.\n\n${renderBoard(envelope())}`;
  };

  const after = (next: SessionEnvelope, lead: string): string => {
    current = next;
    return [lead, ...eventLines(next.events), "", renderBoard(next)].join("\n");
  };

  const play = async (action: LegalAction): Promise<string> => {
    const { session } = envelope();
    const next = await service.applyAction(PLAYER, session.sessionId, {
      actionId: action.actionId,
      expectedVersion: session.version,
    });
    return after(next, `> ${action.text}`);
  };

  const resolve = (words: string[]): LegalAction | string => {
    const actions = envelope().legalActions;
    const [first = "", second] = words;
    if (second !== undefined) {
      const from = Number(first);
      const to = Number(second);
      if (!Number.isInteger(from) || !Number.isInteger(to))
        return "Give two column numbers, for example 3 7.";
      return (
        columnMove(actions, from, to) ?? `No legal move from column ${first} to column ${second}.`
      );
    }
    if (/^\d+$/.test(first)) {
      return actions[Number(first) - 1] ?? `There is no move ${first}. Type moves to see the list.`;
    }
    return (
      actions.find((action) => action.actionId === first) ?? `${first} is not a legal move now.`
    );
  };

  const run = async (verb: string, words: string[]): Promise<CommandResult> => {
    const { session } = envelope();
    switch (verb) {
      case "board":
      case "b":
        return { output: renderBoard(envelope()) };
      case "moves":
      case "m":
        return { output: listMoves(envelope().legalActions) };
      case "deal":
      case "d":
        return run("move", ["DEAL_ROW"]);
      case "hint":
      case "h": {
        const hint = await service.hint(PLAYER, session.sessionId);
        const number = envelope().legalActions.findIndex(
          (action) => action.actionId === hint.action?.actionId,
        );
        return {
          output:
            hint.action === null ? hint.text : `Hint: ${hint.text} (move ${String(number + 1)})`,
        };
      }
      case "undo":
      case "u": {
        const next = await service.undo(PLAYER, session.sessionId, {
          expectedVersion: session.version,
        });
        return { output: after(next, "> Undo") };
      }
      case "new":
        if (session.status === "IN_PROGRESS") {
          await service.abandon(PLAYER, session.sessionId, { expectedVersion: session.version });
        }
        return { output: await begin() };
      case "help":
      case "?":
        return { output: HELP };
      case "quit":
      case "q":
        return { output: "Goodbye.", quit: true };
      case "move": {
        const action = resolve(words);
        return { output: typeof action === "string" ? action : await play(action) };
      }
      default:
        if (/^\d+$/.test(verb)) return run("move", [verb, ...words]);
        return { output: `Unknown command: ${verb}. Type help for the list.` };
    }
  };

  return {
    start: begin,
    handle: async (line) => {
      const [verb = "", ...words] = line.trim().split(/\s+/);
      if (verb === "") return { output: "" };
      try {
        return await run(verb.toLowerCase(), words);
      } catch (error) {
        if (error instanceof GameSessionError) return { output: error.message };
        throw error;
      }
    },
  };
}
