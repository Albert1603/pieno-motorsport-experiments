require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- CONFIGURATION ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

/**
 * Runs the Gemini CLI with a given prompt.
 * Uses a unique prompt file to avoid race conditions.
 */
function runGemini(prompt, requestId) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const promptFile = path.join(TEMP_DIR, `prompt_${requestId}.txt`);
        fs.writeFileSync(promptFile, prompt);

        // Command: Use the unique prompt file
        const cmd = `gemini -y --output-format json -p "$(cat '${promptFile}')"`;

        console.log(` [CLI] [${new Date().toISOString()}] Executing for request ${requestId}...`);
        
        exec(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            console.log(` [CLI] [${new Date().toISOString()}] Request ${requestId} finished in ${duration}ms`);
            // Clean up the temporary prompt file
            if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile);

            if (stderr) console.log(` [CLI-STDERR] ${stderr}`);
            if (error) {
                console.error(` [CLI-ERROR] ${error.message}`);
            }
            
            try {
                // Find the JSON object in the output (ignoring YOLO/Loading messages)
                const jsonStart = stdout.indexOf('{');
                const jsonEnd = stdout.lastIndexOf('}');
                
                if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
                    const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
                    const parsed = JSON.parse(jsonStr);
                    // Add execution time to the response object if it doesn't have stats
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
    });
}

client.once('ready', () => {
    console.log(`------------------------------------------------------`);
    console.log(` [OK] DISCORD BOT ONLINE (WSL): ${client.user.tag}`);
    console.log(` [OK] DIRECT INTERACTION WITH GEMINI CLI`);
    console.log(`------------------------------------------------------`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isTagged = message.mentions.has(client.user);
    const isReply = message.reference && (await message.channel.messages.fetch(message.reference.messageId)).author.id === client.user.id;

    if (isTagged || isReply) {
        const requestId = crypto.randomBytes(4).toString('hex');
        console.log(` [MSG] [${requestId}] From ${message.author.username}: ${message.content.substring(0, 50)}...`);

        // 1. Handle Attachments
        let fileContext = "";
        if (message.attachments.size > 0) {
            for (const [id, att] of message.attachments) {
                const filePath = path.join(TEMP_DIR, att.name);
                try {
                    const response = await fetch(att.url);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    fs.writeFileSync(filePath, buffer);
                    fileContext += ` - User uploaded file: ${att.name} (Local Path: ${filePath})\n`;
                    console.log(` [FILE] [${requestId}] Saved to ${filePath}`);
                } catch (err) {
                    console.error(` [FILE-ERR] [${requestId}] ${err.message}`);
                }
            }
        }

        // 2. Build Prompt
        const userText = message.content.replace(/<@!?\d+>/g, '').trim();
        const fullPrompt = `DISCORD MESSAGE FROM ${message.author.username}: ${userText}\n${fileContext}\n\nINSTRUCTIONS:\n1. Use your tools (read_setup, motec-reader, shell) to help.\n2. If you modify a setup, write it to a new file in ${TEMP_DIR}.\n3. Respond as a Race Engineer.`;

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
        }
    }
});

client.login(DISCORD_TOKEN);
