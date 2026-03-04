require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { ENGINES, detectEngines, setEngine, runCLI, cleanupTempFiles, buildPrompt, buildContext, DEBUG, MAX_ATTACHMENT_SIZE, TEMP_DIR } = require('./core/engine');
const { loadSession, appendToSession, clearSession } = require('./core/session');

// --- DISCORD (only if token is configured) ---

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
let discordClient = null;

if (DISCORD_TOKEN) {
    const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

    discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    discordClient.once('ready', () => {
        console.log(` [OK] DISCORD BOT ONLINE: ${discordClient.user.tag}`);
    });

    /**
     * Walk the Discord reply chain to build conversation history.
     * Returns array of { role: 'user'|'engineer', text: string } in chronological order.
     */
    async function buildDiscordHistory(message, maxHops = 5) {
        const history = [];
        let current = message;

        for (let i = 0; i < maxHops; i++) {
            if (!current.reference) break;
            try {
                const ref = await current.channel.messages.fetch(current.reference.messageId);
                const isBot = ref.author.id === discordClient.user.id;
                let text = ref.content;
                if (isBot) {
                    // Strip latency footer
                    text = text.replace(/\n\n\*\(Tempo di risposta:.*?\)\*$/, '').trim();
                }
                else {
                    // Strip bot mention
                    text = text.replace(/<@!?\d+>/g, '').trim();
                }
                history.unshift({
                    role: isBot ? 'engineer' : 'user',
                    text: text.substring(0, 2000),
                });
                current = ref;
            } catch {
                break;
            }
        }
        return history;
    }

    discordClient.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const isTagged = message.mentions.has(discordClient.user);
        let isReply = false;
        if (message.reference) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId);
                isReply = refMsg.author.id === discordClient.user.id;
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

            // 2. Build Prompt (with reply-chain history + persistent session)
            const userText = message.content.replace(/<@!?\d+>/g, '').trim();
            const history = await buildDiscordHistory(message);
            const sessionKey = `discord_${message.channel.id}`;
            const session = loadSession(sessionKey);
            const promptOpts = {
                senderLabel: message.author.username,
                userText,
                fileContext,
                sessionContext: session.history,
                history,
            };
            const fullPrompt = buildPrompt(promptOpts);
            const triageCtx = buildContext(promptOpts);

            // Snapshot existing .svm files before the call
            const svmBefore = new Set();
            try {
                for (const f of fs.readdirSync(TEMP_DIR)) {
                    if (f.endsWith('.svm')) svmBefore.add(f);
                }
            } catch { }

            // Refresh typing indicator every 9 seconds while waiting
            const typingInterval = setInterval(() => message.channel.sendTyping(), 9000);
            message.channel.sendTyping();

            try {
                let planMessage = null;
                const data = await runCLI(fullPrompt, requestId, async (plan) => {
                    // Send plan as immediate reply so user sees feedback fast
                    planMessage = await message.reply(`*${plan}*`);
                }, triageCtx);
                clearInterval(typingInterval);

                const responseText = data.response || "No response.";

                // 3. Look for new .svm files created during this request
                const filesToSend = [];
                try {
                    for (const f of fs.readdirSync(TEMP_DIR)) {
                        if (f.endsWith('.svm') && !svmBefore.has(f)) {
                            filesToSend.push(new AttachmentBuilder(path.join(TEMP_DIR, f)));
                        }
                    }
                } catch { }

                // 4. Reply
                let finalContent = responseText;
                if (DEBUG && data.stats && data.stats.botLatencyMs) {
                    const seconds = (data.stats.botLatencyMs / 1000).toFixed(1);
                    finalContent += `\n\n*(Tempo di risposta: ${seconds}s)*`;
                }

                if (planMessage) {
                    // Edit the plan message with the full response
                    if (finalContent.length > 2000) {
                        const chunks = finalContent.match(/[\s\S]{1,2000}/g);
                        await planMessage.edit(chunks[0]);
                        for (let i = 1; i < chunks.length - 1; i++) await message.channel.send(chunks[i]);
                        await message.channel.send({ content: chunks[chunks.length - 1], files: filesToSend });
                    } else {
                        await planMessage.edit({ content: finalContent, files: filesToSend });
                    }
                } else if (finalContent.length > 2000) {
                    const chunks = finalContent.match(/[\s\S]{1,2000}/g);
                    for (let i = 0; i < chunks.length - 1; i++) await message.reply(chunks[i]);
                    await message.reply({ content: chunks[chunks.length - 1], files: filesToSend });
                } else {
                    await message.reply({ content: finalContent, files: filesToSend });
                }
                appendToSession(sessionKey, userText, responseText);
                console.log(` [OK] [${requestId}] Replied to ${message.author.username}`);
            } catch (err) {
                clearInterval(typingInterval);
                console.error(` [ERR] [${requestId}] ${err.stack}`);
                await message.reply(`Error: ${err.message}`);
            } finally {
                for (const filePath of downloadedFiles) {
                    try {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    } catch { }
                }
            }
        }
    });

    discordClient.login(DISCORD_TOKEN).catch((err) => {
        console.error(` [DISCORD] Failed to connect: ${err.message}`);
    });
} else {
    console.log(` [DISCORD] No DISCORD_TOKEN set, skipping Discord.`);
}

// --- CLI ---

// Parse file arguments from command line
const fileArgs = process.argv.slice(2);
let cliFileContext = '';
for (const f of fileArgs) {
    const absPath = path.resolve(f);
    if (fs.existsSync(absPath)) {
        cliFileContext += ` - File: ${path.basename(absPath)} (Local Path: ${absPath})\n`;
        console.log(` [FILE] Loaded: ${absPath}`);
    } else {
        console.error(` [FILE] Not found: ${absPath}`);
    }
}

const senderLabel = os.userInfo().username;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Clean up stale temp files on startup and every hour
cleanupTempFiles();
setInterval(cleanupTempFiles, 3600_000);

// Detect available engines and let user pick
const available = detectEngines();
if (available.length === 0) {
    console.error(' [ERROR] No AI CLI found. Install one of: codex, gemini, claude');
    process.exit(1);
}

function startCLI(engineId) {
    setEngine(engineId);

    console.log(`------------------------------------------------------`);
    console.log(` Race Engineer — ${ENGINES[engineId].name}${discordClient ? ' + Discord' : ''}${DEBUG ? ' [DEBUG]' : ''}`);
    console.log(` Type your message below, /quit or /exit to leave.`);
    console.log(` /clear to reset conversation history.`);
    console.log(` /engine to switch AI engine.`);
    if (cliFileContext) console.log(` Files loaded: ${fileArgs.length}`);
    console.log(`------------------------------------------------------`);

    prompt();
}

function pickEngine() {
    if (available.length === 1) {
        startCLI(available[0]);
        return;
    }
    console.log('\n Available AI engines:');
    available.forEach((id, i) => console.log(`  ${i + 1}. ${ENGINES[id].name} (${id})`));
    rl.question(`\n Pick engine [1-${available.length}]: `, (answer) => {
        const idx = parseInt(answer, 10) - 1;
        if (idx >= 0 && idx < available.length) {
            startCLI(available[idx]);
        } else {
            console.log(' Invalid choice, try again.');
            pickEngine();
        }
    });
}

function prompt() {
    rl.question('> ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) return prompt();
        if (trimmed === '/quit' || trimmed === '/exit') {
            console.log('Goodbye.');
            if (discordClient) discordClient.destroy();
            rl.close();
            return;
        }
        if (trimmed === '/clear') {
            clearSession('cli');
            console.log('Conversation history cleared.\n');
            return prompt();
        }
        if (trimmed === '/engine') {
            return pickEngine();
        }

        const requestId = crypto.randomBytes(4).toString('hex');
        const session = loadSession('cli');
        const promptOpts = {
            senderLabel,
            userText: trimmed,
            fileContext: cliFileContext,
            sessionContext: session.history,
        };
        const fullPrompt = buildPrompt(promptOpts);
        const triageCtx = buildContext(promptOpts);

        // Snapshot existing .svm files before the call
        const svmBefore = new Set();
        try {
            for (const f of fs.readdirSync(TEMP_DIR)) {
                if (f.endsWith('.svm')) svmBefore.add(f);
            }
        } catch { }

        try {
            const data = await runCLI(fullPrompt, requestId, (plan) => {
                console.log(`\n> ${plan}\n`);
            }, triageCtx);
            const responseText = data.response || "No response.";
            appendToSession('cli', trimmed, responseText);

            console.log(`\n${responseText}`);

            if (DEBUG && data.stats && data.stats.botLatencyMs) {
                const seconds = (data.stats.botLatencyMs / 1000).toFixed(1);
                console.log(`\n(Response time: ${seconds}s)`);
            }

            // Check for new .svm files
            try {
                for (const f of fs.readdirSync(TEMP_DIR)) {
                    if (f.endsWith('.svm') && !svmBefore.has(f)) {
                        console.log(` [FILE] Setup file created: ${path.join(TEMP_DIR, f)}`);
                    }
                }
            } catch { }
        } catch (err) {
            console.error(`Error: ${err.message}`);
        }

        console.log();
        prompt();
    });
}

pickEngine();
