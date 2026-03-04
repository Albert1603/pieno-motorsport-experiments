const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const DEBUG = process.argv.includes('--debug');
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB
const GEMINI_TIMEOUT = 300_000; // 5 minutes

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Load system prompt from file
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'system-prompt.md'), 'utf-8');

/**
 * Runs the Gemini CLI with a given prompt.
 * Uses spawn to avoid shell injection and pipes prompt via stdin.
 */
function runGemini(prompt, requestId) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        console.log(` [CLI] [${new Date().toISOString()}] Executing for request ${requestId}...`);

        const child = spawn('gemini', ['-y', '--output-format', 'json'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: GEMINI_TIMEOUT,
            cwd: path.resolve(__dirname, '..', '..'),
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err) => {
            console.error(` [CLI-ERROR] ${err.message}`);
            reject(new Error(`Gemini CLI failed to start: ${err.message}`));
        });

        child.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(` [CLI] [${new Date().toISOString()}] Request ${requestId} finished in ${duration}ms (exit code: ${code})`);

            if (DEBUG && stderr) console.debug(` [CLI-STDERR] ${stderr}`);

            try {
                const jsonStart = stdout.indexOf('{');
                const jsonEnd = stdout.lastIndexOf('}');

                if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
                    const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
                    const parsed = JSON.parse(jsonStr);
                    if (!parsed.stats) parsed.stats = {};
                    parsed.stats.botLatencyMs = duration;
                    resolve(parsed);
                } else {
                    const cleanOutput = stdout.replace(/YOLO mode is enabled.*/g, '').trim();
                    resolve({ response: cleanOutput || "No usable output from CLI.", stats: { botLatencyMs: duration } });
                }
            } catch (e) {
                console.error(` [PARSE-ERROR] ${e.message}`);
                resolve({ response: `Error parsing CLI output. Raw output: ${stdout.substring(0, 500)}...`, stats: { botLatencyMs: duration } });
            }
        });

        // Send prompt via stdin to avoid shell injection
        child.stdin.write(prompt);
        child.stdin.end();
    });
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
 * Build the full prompt for Gemini.
 * @param {Object} opts
 * @param {Array<{role: 'user'|'engineer', text: string}>} [opts.sessionContext] - Persistent session history from disk
 * @param {Array<{role: 'user'|'engineer', text: string}>} [opts.history] - Recent conversation history (e.g. Discord reply chain)
 */
function buildPrompt({ senderLabel, userText, fileContext, systemPrompt, tempDir, sessionContext, history }) {
    const prompt = systemPrompt || SYSTEM_PROMPT;
    const dir = tempDir || TEMP_DIR;

    let parts = [prompt.replace('the temp directory', dir)];

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

module.exports = {
    runGemini,
    cleanupTempFiles,
    buildPrompt,
    DEBUG,
    GEMINI_TIMEOUT,
    MAX_ATTACHMENT_SIZE,
    TEMP_DIR,
    SYSTEM_PROMPT,
};
