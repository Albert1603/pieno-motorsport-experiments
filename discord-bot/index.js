require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- CONFIGURATION ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TEMP_DIR = path.join(__dirname, 'temp');
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB
const GEMINI_TIMEOUT = 300_000; // 5 minutes

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Load system prompt from file
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf-8');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

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
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err) => {
            const duration = Date.now() - startTime;
            console.error(` [CLI-ERROR] ${err.message}`);
            reject(new Error(`Gemini CLI failed to start: ${err.message}`));
        });

        child.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(` [CLI] [${new Date().toISOString()}] Request ${requestId} finished in ${duration}ms (exit code: ${code})`);

            if (stderr) console.log(` [CLI-STDERR] ${stderr}`);

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

client.once('ready', () => {
    console.log(`------------------------------------------------------`);
    console.log(` [OK] DISCORD BOT ONLINE (WSL): ${client.user.tag}`);
    console.log(` [OK] DIRECT INTERACTION WITH GEMINI CLI`);
    console.log(`------------------------------------------------------`);

    // Clean up stale temp files on startup and every hour
    cleanupTempFiles();
    setInterval(cleanupTempFiles, 3600_000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isTagged = message.mentions.has(client.user);
    let isReply = false;
    if (message.reference) {
        try {
            const refMsg = await message.channel.messages.fetch(message.reference.messageId);
            isReply = refMsg.author.id === client.user.id;
        } catch { }
    }

    if (isTagged || isReply) {
        const requestId = crypto.randomBytes(4).toString('hex');
        console.log(` [MSG] [${requestId}] From ${message.author.username}: ${message.content.substring(0, 50)}...`);

        // 1. Handle Attachments
        let fileContext = "";
        const downloadedFiles = [];
        if (message.attachments.size > 0) {
            for (const [id, att] of message.attachments) {
                if (att.size > MAX_ATTACHMENT_SIZE) {
                    console.log(` [FILE] [${requestId}] Skipped ${att.name}: too large (${(att.size / 1024 / 1024).toFixed(1)}MB)`);
                    fileContext += ` - Skipped file ${att.name}: exceeds 50MB size limit\n`;
                    continue;
                }
                const filePath = path.join(TEMP_DIR, `${requestId}_${att.name}`);
                try {
                    const response = await fetch(att.url);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    fs.writeFileSync(filePath, buffer);
                    downloadedFiles.push(filePath);
                    fileContext += ` - User uploaded file: ${att.name} (Local Path: ${filePath})\n`;
                    console.log(` [FILE] [${requestId}] Saved to ${filePath}`);
                } catch (err) {
                    console.error(` [FILE-ERR] [${requestId}] ${err.message}`);
                }
            }
        }

        // 2. Build Prompt
        const userText = message.content.replace(/<@!?\d+>/g, '').trim();
        const fullPrompt = `DISCORD MESSAGE FROM ${message.author.username}: ${userText}\n${fileContext}\n\n${SYSTEM_PROMPT.replace('the temp directory', TEMP_DIR)}`;

        // Refresh typing indicator every 9 seconds while waiting
        const typingInterval = setInterval(() => message.channel.sendTyping(), 9000);
        message.channel.sendTyping();

        try {
            const data = await runGemini(fullPrompt, requestId);
            clearInterval(typingInterval);

            const responseText = data.response || "No response.";

            // 3. Look for files to send back
            const filesToSend = [];
            // Regex to find filenames in the response (e.g., .svm files)
            const svmMatches = responseText.match(/[\w\s.-]+\.svm/g);
            if (svmMatches) {
                const uniqueFiles = [...new Set(svmMatches.map(f => f.trim()))];
                for (const filename of uniqueFiles) {
                    const filePath = path.join(TEMP_DIR, filename);
                    if (fs.existsSync(filePath)) {
                        filesToSend.push(new AttachmentBuilder(filePath));
                    }
                }
            }

            // 4. Reply
            let finalContent = responseText;
            if (data.stats && data.stats.botLatencyMs) {
                const seconds = (data.stats.botLatencyMs / 1000).toFixed(1);
                finalContent += `\n\n*(Tempo di risposta: ${seconds}s)*`;
            }

            if (finalContent.length > 2000) {
                const chunks = finalContent.match(/[\s\S]{1,2000}/g);
                for (const chunk of chunks) await message.reply(chunk);
            } else {
                await message.reply({ content: finalContent, files: filesToSend });
            }
            console.log(` [OK] [${requestId}] Replied to ${message.author.username}`);
        } catch (err) {
            clearInterval(typingInterval);
            console.error(` [ERR] [${requestId}] ${err.stack}`);
            await message.reply(`❌ System Error: ${err.message}`);
        } finally {
            // Clean up downloaded attachment files
            for (const filePath of downloadedFiles) {
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch { }
            }
        }
    }
});

client.login(DISCORD_TOKEN);
