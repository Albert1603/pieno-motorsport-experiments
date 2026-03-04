const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const DEBUG = process.argv.includes('--debug');
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB
const CLI_TIMEOUT = 300_000; // 5 minutes
const TRIAGE_TIMEOUT = 60_000; // 1 minute for triage

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Load system prompt from file
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'system-prompt.md'), 'utf-8');

const TRIAGE_PROMPT = `You are a triage router for a race engineer AI. Given the user's message and conversation history, decide if this needs tool use or can be answered directly.

Respond with EXACTLY one of these formats — nothing else:

DIRECT: <your complete answer to the user>

PLAN: <one-sentence summary of what you'll do, in the user's language>

Rules:
- Use DIRECT ONLY for: greetings, small talk, general racing knowledge, clarifications about what the user wants.
- Use PLAN for: ANYTHING about telemetry data, lap times, lap counts, tyre temps, speed, setup values, file contents, or any question whose answer depends on reading actual files. You do NOT have access to any files — you CANNOT answer data questions.
- NEVER invent or guess telemetry values, lap times, or file contents. If the answer requires reading a file, it MUST be PLAN.
- Keep DIRECT answers concise and in-character as a dry, direct race engineer.
- Keep PLAN summaries to one short sentence.
- Always respond in the same language the user writes in.`;

// --- ENGINE DEFINITIONS ---

const ENGINES = {
    codex: {
        name: 'Codex',
        command: 'codex',
        triage: { args: ['exec', '--ephemeral'] },
        exec: { args: ['exec', '--full-auto'] },
        parseOutput: (stdout) => stdout,
    },
    gemini: {
        name: 'Gemini',
        command: 'gemini',
        triage: { args: [] },
        exec: { args: ['-y', '--output-format', 'json'] },
        parseOutput: (stdout) => {
            try {
                const jsonStart = stdout.indexOf('{');
                const jsonEnd = stdout.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
                    const parsed = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
                    return parsed.response || stdout;
                }
                return stdout.replace(/YOLO mode is enabled.*/g, '').trim();
            } catch {
                return stdout;
            }
        },
    },
    claude: {
        name: 'Claude',
        command: 'claude',
        triage: { args: ['-p', '--no-session-persistence', '--output-format', 'text', '--model', 'haiku'] },
        exec: { args: ['-p', '--dangerously-skip-permissions', '--output-format', 'text', '--model', 'sonnet'] },
        parseOutput: (stdout) => stdout,
    },
};

/**
 * Detect which AI CLIs are available on the system.
 */
function detectEngines() {
    const available = [];
    for (const [id, engine] of Object.entries(ENGINES)) {
        try {
            execFileSync('which', [engine.command], { stdio: 'ignore' });
            available.push(id);
        } catch {
            // not installed
        }
    }
    return available;
}

let activeEngine = null;

/**
 * Set the active engine by id.
 */
function setEngine(engineId) {
    if (!ENGINES[engineId]) throw new Error(`Unknown engine: ${engineId}`);
    activeEngine = ENGINES[engineId];
    console.log(` [ENGINE] Using ${activeEngine.name}`);
}

/**
 * Spawns a CLI process with given command, args, and prompt via stdin.
 */
function spawnCLI(command, args, prompt, timeout, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout,
            cwd,
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err) => {
            if (err.code === 'ETIMEDOUT') {
                killed = true;
                return;
            }
            reject(new Error(`${command} CLI failed to start: ${err.message}`));
        });

        child.on('close', (code, signal) => {
            if (DEBUG && stderr) console.debug(` [CLI-STDERR] ${stderr}`);
            resolve({ stdout: stdout.trim(), stderr, code, signal, timedOut: killed || signal === 'SIGTERM' });
        });

        child.stdin.write(prompt);
        child.stdin.end();
    });
}

/**
 * Two-phase AI engine:
 * 1. Triage (fast, no tools) — answers directly or returns a plan
 * 2. Execute (only if triage says PLAN) — full tool access
 *
 * Returns { response, plan, stats } where plan is set only if execution was needed.
 * The caller can send `plan` immediately and `response` when ready.
 */
async function runCLI(prompt, requestId, onPlan, triageContext) {
    const engine = activeEngine;
    if (!engine) throw new Error('No engine selected. Call setEngine() first.');

    const startTime = Date.now();
    const projectRoot = path.resolve(__dirname, '..', '..');

    console.log(` [TRIAGE] [${new Date().toISOString()}] Request ${requestId} (${engine.name})...`);

    // Phase 1: Triage (no tools, fast)
    const triageInput = `${TRIAGE_PROMPT}\n\n---\n\n${triageContext || prompt}`;
    const triage = await spawnCLI(engine.command, engine.triage.args, triageInput, TRIAGE_TIMEOUT, projectRoot);
    const triageDuration = Date.now() - startTime;
    console.log(` [TRIAGE] [${new Date().toISOString()}] Request ${requestId} triaged in ${triageDuration}ms`);

    const triageOutput = triage.stdout.trim();
    if (DEBUG) console.debug(` [TRIAGE-RAW] ${triageOutput}`);

    // Check if triage answered directly
    const directMatch = triageOutput.match(/DIRECT:\s*([\s\S]+)/i);
    if (directMatch) {
        const duration = Date.now() - startTime;
        console.log(` [DIRECT] [${new Date().toISOString()}] Request ${requestId} answered directly in ${duration}ms`);
        return { response: directMatch[1].trim(), stats: { botLatencyMs: duration } };
    }

    // Extract plan
    const planMatch = triageOutput.match(/PLAN:\s*([\s\S]+)/i);
    const plan = planMatch ? planMatch[1].trim() : null;

    if (plan) {
        console.log(` [PLAN] [${new Date().toISOString()}] Request ${requestId}: ${plan}`);
        if (onPlan) await onPlan(plan);
    }

    // Phase 2: Full execution with tools
    console.log(` [EXEC] [${new Date().toISOString()}] Executing for request ${requestId}...`);
    const exec = await spawnCLI(engine.command, engine.exec.args, prompt, CLI_TIMEOUT, projectRoot);
    const duration = Date.now() - startTime;
    console.log(` [EXEC] [${new Date().toISOString()}] Request ${requestId} finished in ${duration}ms (timedOut: ${exec.timedOut})`);

    if (exec.timedOut) {
        return { response: "L'analisi ha superato il tempo massimo. Prova con una richiesta più specifica (es. un singolo canale o un aspetto preciso).", plan, stats: { botLatencyMs: duration } };
    }

    const response = engine.parseOutput(exec.stdout);
    return { response: response || "No usable output from CLI.", plan, stats: { botLatencyMs: duration } };
}

/**
 * Clean up stale temp files older than 1 hour.
 */
function cleanupTempFiles() {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > 3600_000) {
                fs.unlinkSync(filePath);
                console.log(` [CLEANUP] Removed stale file: ${file}`);
            }
        }
    } catch (err) {
        console.error(` [CLEANUP-ERR] ${err.message}`);
    }
}

/**
 * Build history + user message block (shared between triage and full prompt).
 */
function buildContext({ senderLabel, userText, fileContext, sessionContext, history }) {
    const parts = [];

    // Merge session context (older, from disk) with recent history (e.g. reply chain)
    // Dedup: skip sessionContext entries whose text already appears in history
    // Only inject the last 10 session entries to keep prompt size down
    const historyTexts = new Set((history || []).map(h => h.text));
    const trimmedSession = (sessionContext || []).slice(-10);
    const merged = [
        ...trimmedSession.filter(h => !historyTexts.has(h.text)),
        ...(history || []),
    ];

    if (merged.length > 0) {
        const historyBlock = merged.map(h => `[${h.role}]: ${h.text}`).join('\n');
        parts.push(`CONVERSATION HISTORY:\n${historyBlock}`);
    }

    parts.push(`CURRENT MESSAGE FROM ${senderLabel}: ${userText}\n${fileContext || ''}`);

    return parts.join('\n\n');
}

/**
 * Build the full prompt for the AI engine (system prompt + context).
 */
function buildPrompt(opts) {
    const prompt = opts.systemPrompt || SYSTEM_PROMPT;
    const dir = opts.tempDir || TEMP_DIR;

    return `${prompt.replace('the temp directory', dir)}\n\n${buildContext(opts)}`;
}

module.exports = {
    ENGINES,
    detectEngines,
    setEngine,
    runCLI,
    cleanupTempFiles,
    buildPrompt,
    buildContext,
    DEBUG,
    CLI_TIMEOUT,
    MAX_ATTACHMENT_SIZE,
    TEMP_DIR,
    SYSTEM_PROMPT,
};
