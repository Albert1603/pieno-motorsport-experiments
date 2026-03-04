const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/**
 * Load a session from disk.
 * Returns { history: [], lastActive: null } if missing or corrupt.
 */
function loadSession(sessionId) {
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (err) {
        console.error(` [SESSION] Failed to load ${sessionId}: ${err.message}`);
    }
    return { history: [], lastActive: null };
}

/**
 * Append a user+engineer exchange to a session file.
 * Caps individual texts at 2000 chars and trims oldest pairs beyond maxExchanges.
 */
function appendToSession(sessionId, userText, engineerText, maxExchanges = 20) {
    const session = loadSession(sessionId);
    const now = new Date().toISOString();

    session.history.push(
        { role: 'user', text: userText.substring(0, 2000), ts: now },
        { role: 'engineer', text: engineerText.substring(0, 2000), ts: now },
    );

    // Trim oldest pairs if over limit (each exchange = 2 entries)
    while (session.history.length > maxExchanges * 2) {
        session.history.shift();
        session.history.shift();
    }

    session.lastActive = now;

    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

/**
 * Delete a session file.
 */
function clearSession(sessionId) {
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.error(` [SESSION] Failed to clear ${sessionId}: ${err.message}`);
    }
}

module.exports = { loadSession, appendToSession, clearSession, SESSIONS_DIR };
