/*
 * `npm run dev` at the repository root (local-development.md section 5): stops
 * any All Play local processes still running, then starts the backend local
 * server and the web app's Vite from scratch, with prefixed output. Ctrl-C
 * stops both. `npm run dev -- --dry-run` only lists what would be stopped.
 */
import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The local server, Vite dev server and Vite preview ports. */
export const PORTS = [4000, 5173, 4173];

/** Command lines that are All Play local processes, when they also run inside `root`. */
const LOCAL_COMMAND = /(src\/local\/start\.ts|dev:server|kokoro\/worker\.py|\bvite\b)/;

/**
 * Picks the processes to stop from `ps -axo pid=,command=` output: local
 * server and Vite processes whose command line names this checkout, plus
 * anything listening on an All Play port whose working directory is inside it.
 */
export function selectAllPlayProcesses({ psLines, root, portPids = [], cwdOf = () => null, self }) {
  const inRepo = (path) => path === root || path.startsWith(`${root}/`);
  const chosen = new Set();
  for (const line of psLines) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (pid !== self && command.includes(`${root}/`) && LOCAL_COMMAND.test(command)) chosen.add(pid);
  }
  for (const pid of portPids) {
    const cwd = cwdOf(pid);
    if (pid !== self && cwd !== null && inRepo(cwd)) chosen.add(pid);
  }
  return [...chosen].sort((a, b) => a - b);
}

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

function findRunning() {
  const portPids = PORTS.flatMap((port) =>
    run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split("\n").filter(Boolean).map(Number),
  );
  const cwdOf = (pid) => {
    const line = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"));
    return line === undefined ? null : line.slice(1);
  };
  return selectAllPlayProcesses({
    psLines: run("ps", ["-axo", "pid=,command="]).split("\n"),
    root: ROOT,
    portPids,
    cwdOf,
    self: process.pid,
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function stop(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* Already gone. */
    }
  }
  for (let waited = 0; waited < 3000 && pids.some(alive); waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const pid of pids.filter(alive)) process.kill(pid, "SIGKILL");
}

/** Starts one npm script with each output line prefixed. */
function start(name, cwd, args) {
  const child = spawn("npm", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
}

async function main() {
  const running = findRunning();
  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`Would stop: ${running.length === 0 ? "nothing" : running.join(", ")}\n`);
    for (const pid of running) process.stdout.write(`  ${run("ps", ["-o", "pid=,command=", "-p", String(pid)]).trim()}\n`);
    return;
  }
  if (running.length > 0) {
    process.stdout.write(`Stopping All Play processes: ${running.join(", ")}\n`);
    await stop(running);
  }
  const children = [
    start("api", join(ROOT, "backend"), ["run", "dev:server"]),
    start("web", join(ROOT, "web-app"), ["run", "dev", "--", "--force"]),
  ];
  process.stdout.write("All Play local stack: web http://localhost:5173, API http://localhost:4000\n");
  let stopping = false;
  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    setTimeout(() => process.exit(code), 500);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  for (const child of children) {
    child.on("exit", (code) => {
      if (!stopping) {
        process.stderr.write(`A server exited (code ${String(code)}); stopping the other.\n`);
        shutdown(code ?? 1);
      }
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
