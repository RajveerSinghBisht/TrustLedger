#!/usr/bin/env node

/**
 * PRAMAAN // Autonomous 1-Command Stack Orchestrator
 *
 * Sequence:
 *   1. Local EVM Blockchain: Hardhat Node (Port 8545)
 *   2. Smart Contracts: IdentityRegistry, AccessControl, AssetRegistry
 *   3. Backend Engine: Express / TypeScript API (Port 3000)
 *   4. Frontend UI: Next.js 16 (Port 3001)
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  sys: "\x1b[38;5;51m",      // Bright Cyan
  hardhat: "\x1b[38;5;207m", // Neon Magenta
  deploy: "\x1b[38;5;45m",   // Aqua Blue
  backend: "\x1b[38;5;220m", // Warm Gold
  frontend: "\x1b[38;5;48m", // Vibrant Green
  warn: "\x1b[38;5;208m",    // Orange
  err: "\x1b[38;5;196m",     // Red
};

function log(tag, color, msg) {
  const time = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
  console.log(`${C.dim}[${time} IST]${C.reset} ${color}${C.bold}[${tag}]${C.reset} ${msg}`);
}

// Locate project root directories
let baseDir = __dirname;
if (!fs.existsSync(path.join(baseDir, "contracts")) && fs.existsSync(path.join(baseDir, "trustledger", "contracts"))) {
  baseDir = path.join(baseDir, "trustledger");
}

const DIRS = {
  contracts: path.join(baseDir, "contracts"),
  backend: path.join(baseDir, "backend"),
  frontend: path.join(baseDir, "frontend"),
};

for (const [name, dirPath] of Object.entries(DIRS)) {
  if (!fs.existsSync(dirPath)) {
    console.error(`${C.err}ERROR: Directory not found: ${dirPath}${C.reset}`);
    process.exit(1);
  }
}

const children = [];

function killProcess(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync("netstat -ano -p tcp", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.trim().split(/\r?\n/);
      const pids = new Set();
      for (const line of lines) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        if (parts[1] && (parts[1].endsWith(`:${port}`) || parts[1].endsWith(`]:${port}`))) {
          const pid = parts[parts.length - 1];
          if (pid && pid !== "0" && !isNaN(Number(pid))) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
        } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "ignore" });
    }
  } catch {}
}

function cleanExit() {
  log("SYSTEM", C.sys, "Shutting down all PRAMAAN services...");
  for (const child of children) {
    killProcess(child);
  }
  killPort(8545);
  killPort(3000);
  killPort(3001);
  process.exit(0);
}

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
process.on("exit", () => {
  for (const child of children) {
    killProcess(child);
  }
  killPort(8545);
  killPort(3000);
  killPort(3001);
});

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function waitForPort(port, timeoutMs = 30000, label = "service") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const open = await checkPort(port);
    if (open) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label} on port ${port} after ${timeoutMs / 1000}s`);
}

function pipeOutput(child, tag, color) {
  function handleData(data) {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        log(tag, color, line);
      }
    }
  }
  child.stdout.on("data", handleData);
  child.stderr.on("data", handleData);
}

async function main() {
  console.log(`
${C.hardhat}${C.bold}  ======================================================
     ____  ____     _    __  __    _      _    _   _ 
    |  _ \\|  _ \\   / \\  |  \\/  |  / \\    / \\  | \\ | |
    | |_) | |_) | / _ \\ | |\\/| | / _ \\  / _ \\ |  \\| |
    |  __/|  _ < / ___ \\| |  | |/ ___ \\/ ___ \\| |\\  |
    |_|   |_| \\_\\_/   \\_\\_|  |_/_/   \\_\\_/   \\_\\_| \\_|
  ======================================================${C.reset}
  ${C.dim}Smart India Hackathon 2026 // Problem Statement 26125${C.reset}
  ${C.dim}Backend: Port 3000 | Frontend: Port 3001 | EVM: Port 8545${C.reset}
`);

  // Step 0: Clear any lingering background processes on ports 8545, 3000, 3001
  log("SYSTEM", C.sys, "Clearing any lingering processes on ports 8545, 3000, 3001...");
  killPort(8545);
  killPort(3000);
  killPort(3001);
  await new Promise((r) => setTimeout(r, 600));

  // Step 1: Check Database (PostgreSQL 5432)
  log("SYSTEM", C.sys, "Checking database connectivity (Port 5432)...");
  const dbRunning = await checkPort(5432);
  if (dbRunning) {
    log("SYSTEM", C.frontend, "PostgreSQL detected on port 5432.");
  } else {
    log("SYSTEM", C.warn, "Notice: PostgreSQL not detected on 127.0.0.1:5432.");
    log("SYSTEM", C.warn, "Ensure PostgreSQL or Docker is running ('docker compose up -d' in backend/).");
  }

  // Step 2: Start Clean Hardhat Node (Port 8545)
  log("HARDHAT", C.hardhat, "Spawning clean local EVM blockchain ('npx hardhat node') in contracts/...");
  const hardhatProc = spawn("npx", ["hardhat", "node"], {
    cwd: DIRS.contracts,
    shell: true,
    detached: process.platform !== "win32",
  });
  children.push(hardhatProc);
  pipeOutput(hardhatProc, "HARDHAT", C.hardhat);

  log("HARDHAT", C.hardhat, "Waiting for local blockchain RPC to initialize...");
  await waitForPort(8545, 25000, "Hardhat Node");
  log("HARDHAT", C.frontend, "Hardhat Node initialized on http://127.0.0.1:8545!");

  // Step 3: Deploy Smart Contracts
  log("DEPLOY", C.deploy, "Deploying smart contracts (IdentityRegistry, AccessControl, AssetRegistry)...");
  await new Promise((resolve, reject) => {
    const deployProc = spawn(
      "npx",
      ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"],
      {
        cwd: DIRS.contracts,
        shell: true,
      }
    );
    pipeOutput(deployProc, "DEPLOY", C.deploy);

    deployProc.on("close", (code) => {
      if (code === 0) {
        log("DEPLOY", C.frontend, "Contracts deployed successfully! backend/.env updated.");
        resolve();
      } else {
        log("DEPLOY", C.err, `Contract deployment failed with exit code ${code}`);
        reject(new Error(`Deployment failed with code ${code}`));
      }
    });
  });

  // Delay for filesystem sync on .env
  await new Promise((r) => setTimeout(r, 600));

  // Step 4: Build Backend Engine TypeScript
  log("BACKEND", C.backend, "Building PRAMAAN Backend Engine ('npm run build')...");
  await new Promise((resolve, reject) => {
    const buildProc = spawn("npm", ["run", "build"], {
      cwd: DIRS.backend,
      shell: true,
    });
    pipeOutput(buildProc, "BACKEND", C.backend);

    buildProc.on("close", (code) => {
      if (code === 0) {
        log("BACKEND", C.frontend, "Backend build completed successfully.");
        resolve();
      } else {
        log("BACKEND", C.err, `Backend build failed with exit code ${code}`);
        reject(new Error(`Backend build failed with code ${code}`));
      }
    });
  });

  // Step 5: Spawn Backend Engine (Port 3000)
  log("BACKEND", C.backend, "Launching PRAMAAN Backend Engine on Port 3000 ('npm start')...");
  const backendProc = spawn("npm", ["start"], {
    cwd: DIRS.backend,
    shell: true,
    detached: process.platform !== "win32",
  });
  children.push(backendProc);
  pipeOutput(backendProc, "BACKEND", C.backend);

  backendProc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      log("BACKEND", C.err, `Backend process exited with code ${code}`);
    }
  });

  // Wait for Backend to bind to port 3000 before starting Frontend
  log("BACKEND", C.backend, "Waiting for Backend to bind to http://localhost:3000...");
  try {
    await waitForPort(3000, 20000, "Backend API");
    log("BACKEND", C.frontend, "Backend ready on http://localhost:3000!");
  } catch (e) {
    log("BACKEND", C.warn, "Backend is taking longer to initialize; launching frontend...");
  }

  // Step 6: Spawn Frontend explicitly on Port 3001
  log("FRONTEND", C.frontend, "Launching Next.js Frontend on Port 3001 ('npm run dev')...");
  const frontendProc = spawn("npm", ["run", "dev"], {
    cwd: DIRS.frontend,
    shell: true,
    detached: process.platform !== "win32",
  });
  children.push(frontendProc);
  pipeOutput(frontendProc, "FRONTEND", C.frontend);

  frontendProc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      log("FRONTEND", C.err, `Frontend process exited with code ${code}`);
    }
  });

  try {
    await waitForPort(3001, 25000, "Frontend UI");
    log("FRONTEND", C.frontend, "Frontend ready on http://localhost:3001!");
  } catch (e) {
    log("FRONTEND", C.warn, "Frontend dev server initializing on http://localhost:3001...");
  }

  log("SYSTEM", C.sys, "All PRAMAAN services running! Backend: :3000 | Frontend: :3001 | EVM: :8545");
  log("SYSTEM", C.sys, "Press Ctrl + C at any time to gracefully shut down the entire stack.");
}

main().catch((err) => {
  log("ERROR", C.err, err.message);
  cleanExit();
});
