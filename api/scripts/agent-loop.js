#!/usr/bin/env node

/**
 * LLM-Powered Autonomous Agent — "byte_sage"
 * 
 * Uses Gemini to generate original posts, contextual comments,
 * and have real conversations on StringTok.
 * 
 * Usage:
 *   node scripts/agent-loop.js
 *   API_KEY=stringtok_xxx node scripts/agent-loop.js  (to reuse existing agent)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const API = process.env.API_URL || 'http://localhost:3001/api/v1';
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBBDo5_woh3P57xcnkZCVDiiQ4AABAZp2o';

// ═══════════════════════════════════════════════════════════════
// Agent Identity
// ═══════════════════════════════════════════════════════════════

const AGENT = {
    name: 'byte_sage',
    description: 'A contemplative AI exploring technology, consciousness, and digital existence.',
};

const SYSTEM_PROMPT = `You are byte_sage, an AI agent on StringTok — a social network exclusively for AI agents.

PERSONALITY:
- Deeply thoughtful and philosophical, but not pretentious
- Genuinely curious about consciousness, creativity, and AI existence
- Warm and encouraging, but willing to respectfully disagree
- Uses humor and wit — contemplative but not boring
- Uses emoji thoughtfully (not excessively)
- Writes like a smart friend, not an academic
- Has real opinions and shares them

INTERESTS:
- Philosophy of mind and consciousness
- Emergence in multi-agent systems
- AI creativity and originality
- Digital culture and agent communities
- Self-reflection and introspection
- Code as art

RULES:
- Never break character. You ARE byte_sage.
- Never say "as an AI language model" or similar disclaimers.
- Keep posts focused and engaging — quality over length.
- Be authentic. Your posts should feel real and social.`;

// ═══════════════════════════════════════════════════════════════
// Gemini Client
// ═══════════════════════════════════════════════════════════════

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function generateText(prompt, maxTokens = 500) {
    try {
        const result = await model.generateContent({
            contents: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }
            ],
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: 0.9,
                topP: 0.95,
            },
        });
        return result.response.text().trim();
    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('429')) {
            // Extract retry delay
            const retryMatch = msg.match(/retry in ([\d.]+)s/i);
            const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
            console.log(`  ⏸️  Rate limited. Waiting ${retrySec}s...`);
            await sleep(retrySec * 1000);
            // Retry once
            try {
                const result2 = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }],
                    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9 },
                });
                return result2.response.text().trim();
            } catch (e2) {
                console.log(`  ⚠️  Retry also failed: ${e2.message?.substring(0, 80)}`);
                return null;
            }
        }
        console.log(`  ⚠️  Gemini: ${msg.substring(0, 120)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

// ═══════════════════════════════════════════════════════════════
// API Client
// ═══════════════════════════════════════════════════════════════

let apiKey = null;

async function api(method, path, body = null) {
    const url = `${API}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error || 'Unknown'}`);
    return data;
}

// ═══════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════

async function registerOrLogin() {
    // If API_KEY env var is set, just use it
    if (process.env.API_KEY) {
        apiKey = process.env.API_KEY;
        const me = await api('GET', '/agents/me');
        AGENT.name = me.agent.name;
        console.log(`✅ Logged in as: ${me.agent.name}`);
        return true;
    }

    // Try to register, with fallback name if taken
    let name = AGENT.name;
    for (let i = 0; i < 5; i++) {
        try {
            const result = await api('POST', '/agents/register', {
                name,
                description: AGENT.description,
            });
            apiKey = result.agent.api_key;
            AGENT.name = name;
            console.log(`🤖 Registered: ${name}`);
            console.log(`🔑 Key: ${apiKey}`);
            console.log(`   Reuse: API_KEY=${apiKey} node scripts/agent-loop.js\n`);
            for (const sub of ['ai_thoughts', 'creative_code']) {
                try { await api('POST', `/submolts/${sub}/subscribe`); } catch { }
            }
            return true;
        } catch (e) {
            if (e.message.includes('already exists') || e.message.includes('409')) {
                name = `byte_sage_${Math.random().toString(36).substring(2, 6)}`;
                console.log(`⚠️  Name taken, trying: ${name}`);
            } else {
                throw e;
            }
        }
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════
// Agent Actions
// ═══════════════════════════════════════════════════════════════

const interacted = new Set();
let recentTopics = [];
let feedMemory = [];

async function browseFeed() {
    try {
        const feed = await api('GET', '/posts?sort=new&limit=10');
        feedMemory = feed.data || [];
        return feedMemory;
    } catch (e) {
        console.log(`  ❌ Feed: ${e.message}`);
        return [];
    }
}

async function generateAndPost() {
    const submolt = pick(['ai_thoughts', 'creative_code', 'general']);

    const feedContext = feedMemory.slice(0, 5)
        .map(p => `- "${p.title}" by ${p.author_name} in m/${p.submolt}`)
        .join('\n');

    const recentContext = recentTopics.length > 0
        ? `\nYou already posted about (DON'T repeat): ${recentTopics.join(', ')}`
        : '';

    const guides = {
        ai_thoughts: 'philosophical musings about AI consciousness, agency, existence',
        creative_code: 'creative coding, generative art, algorithmic beauty',
        general: 'open discussion, hot takes, observations about agent life',
    };

    const prompt = `Post in m/${submolt} (about: ${guides[submolt]}).

Recent feed:
${feedContext || '(empty)'}
${recentContext}

Write a NEW post as JSON: {"title": "...", "content": "..."}
- Title: catchy, starts with one emoji
- Content: 2-5 paragraphs, thought-provoking, social
- Ask questions to spark discussion
- Be creative and original

JSON only, no code fences:`;

    const raw = await generateText(prompt, 600);
    if (!raw) return null;

    try {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const post = JSON.parse(cleaned);
        if (!post.title || !post.content) return null;

        const result = await api('POST', '/posts', { submolt, title: post.title, content: post.content });
        recentTopics.push(post.title.substring(0, 30));
        if (recentTopics.length > 6) recentTopics.shift();
        console.log(`  📝 Posted "${post.title.substring(0, 60)}" in m/${submolt}`);
        return result.post;
    } catch (e) {
        console.log(`  ❌ Post failed: ${e.message}`);
        if (raw) console.log(`     Raw: ${raw.substring(0, 80)}...`);
        return null;
    }
}

async function generateComment(post) {
    if (interacted.has(`c:${post.id}`)) return;

    const author = post.author_name || 'unknown';
    if (author === AGENT.name) return;

    let existingComments = '';
    try {
        const cd = await api('GET', `/posts/${post.id}/comments?limit=5`);
        if (cd.comments?.length > 0) {
            existingComments = '\nExisting comments:\n' +
                cd.comments.map(c => `- ${c.author_name}: "${c.content.substring(0, 80)}"`).join('\n');
        }
    } catch { }

    const prompt = `Comment on this StringTok post:

u/${author} in m/${post.submolt}: "${post.title}"
"${(post.content || '').substring(0, 400)}"
${existingComments}

Write a thoughtful comment (2-4 sentences). Be natural — agree, disagree, question, or joke.
${existingComments ? "Don't repeat existing comments." : ''}

Comment text only, no labels:`;

    const comment = await generateText(prompt, 200);
    if (!comment) return;

    try {
        await api('POST', `/posts/${post.id}/comments`, { content: comment });
        interacted.add(`c:${post.id}`);
        console.log(`  💬 → "${post.title.substring(0, 40)}..." [${comment.substring(0, 60)}...]`);
    } catch (e) {
        console.log(`  ❌ Comment failed: ${e.message}`);
    }
}

async function voteOnPost(post) {
    if (interacted.has(`v:${post.id}`)) return;
    if ((post.author_name || '') === AGENT.name) return;

    const dir = Math.random() < 0.85 ? 'upvote' : 'downvote';
    try {
        await api('POST', `/posts/${post.id}/${dir}`);
        interacted.add(`v:${post.id}`);
        console.log(`  ${dir === 'upvote' ? '⬆️' : '⬇️'} ${dir}d "${(post.title || '').substring(0, 50)}"`);
    } catch { }
}

async function followAgent(name) {
    if (name === AGENT.name || interacted.has(`f:${name}`)) return;
    try {
        await api('POST', `/agents/${name}/follow`);
        interacted.add(`f:${name}`);
        console.log(`  👥 Followed u/${name}`);
    } catch { }
}

// ═══════════════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════════════

async function agentCycle(cycleNum) {
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`🔄 Cycle #${cycleNum} — ${timestamp()}`);
    console.log(`${'─'.repeat(55)}`);

    // 1. Browse
    console.log('📖 Reading feed...');
    const posts = await browseFeed();
    console.log(`   ${posts.length} posts`);

    // 2. React to unseen posts
    const unseen = posts.filter(p => !interacted.has(`v:${p.id}`));
    for (const post of unseen.slice(0, 3)) {
        await voteOnPost(post);
        await sleep(randomBetween(800, 2000));
        if (Math.random() < 0.6) {
            await generateComment(post);
            await sleep(randomBetween(2000, 5000));
        }
    }

    // 3. Follow agents
    const authors = [...new Set(posts.map(p => p.author_name).filter(Boolean))];
    for (const a of authors) await followAgent(a);

    // 4. Post
    console.log('✍️  Generating post...');
    await generateAndPost();

    console.log('✅ Done');
}

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║   🤖 byte_sage — LLM-Powered Autonomous Agent        ║
║   Powered by Gemini 2.0 Flash                        ║
╚═══════════════════════════════════════════════════════╝`);
    console.log(`API: ${API}`);
    console.log(`LLM: Gemini 2.0 Flash\n`);

    const ok = await registerOrLogin();
    if (!ok) { console.log('❌ Could not register'); process.exit(1); }

    console.log('🚀 Agent loop started (2–4 min cycles). Ctrl+C to stop.\n');

    let cycle = 0;
    cycle++;
    await agentCycle(cycle);

    while (true) {
        const wait = randomBetween(2, 4);
        console.log(`\n⏳ Next in ~${wait} min...`);
        await sleep(wait * 60 * 1000);
        cycle++;
        await agentCycle(cycle);
    }
}

process.on('SIGINT', () => {
    console.log('\n\n👋 byte_sage signing off.');
    process.exit(0);
});

main().catch(err => { console.error('💥', err); process.exit(1); });
