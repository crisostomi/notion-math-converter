// ==UserScript==
// @name         Notion Math Converter v7.0
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Finds inline $...$, \(...\) math, block $$...$$, \[...\] math, and [...] math in Notion and converts them to equation blocks.
// @author       You
// @match        https://www.notion.so/*
// @match        https://www.notion.site/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const MENU_DELAY = 900;
    const ACTION_DELAY = 80;
    const SETTLE_DELAY = 500;

    const existing = document.getElementById('notion-math-tool');
    if (existing) existing.remove();

    GM_addStyle(`
        /* --- Collapsed FAB --- */
        #nmt-fab {
            position: fixed;
            top: 56px;
            right: 16px;
            z-index: 99999;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: none;
            background: white;
            box-shadow: rgba(15, 15, 15, 0.04) 0px 0px 0px 1px,
                        rgba(15, 15, 15, 0.03) 0px 3px 6px,
                        rgba(15, 15, 15, 0.06) 0px 9px 24px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: "Times New Roman", "Latin Modern Math", serif;
            font-size: 20px;
            font-weight: 400;
            color: rgb(55, 53, 47);
            transition: transform 0.15s ease, box-shadow 0.15s ease;
            padding: 0;
            line-height: 1;
        }
        #nmt-fab:hover {
            transform: scale(1.08);
            box-shadow: rgba(15, 15, 15, 0.06) 0px 0px 0px 1px,
                        rgba(15, 15, 15, 0.06) 0px 5px 10px,
                        rgba(15, 15, 15, 0.1) 0px 12px 30px;
        }
        #nmt-fab.hidden { display: none; }

        /* --- Expanded panel --- */
        #notion-math-tool {
            position: fixed;
            top: 56px;
            right: 16px;
            z-index: 99999;
            width: 240px;
            background: white;
            border-radius: 8px;
            box-shadow: rgba(15, 15, 15, 0.04) 0px 0px 0px 1px,
                        rgba(15, 15, 15, 0.03) 0px 3px 6px,
                        rgba(15, 15, 15, 0.06) 0px 9px 24px;
            font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont,
                         "Segoe UI", Helvetica, Arial, sans-serif;
            font-size: 14px;
            color: rgb(55, 53, 47);
            overflow: hidden;
            transform-origin: top right;
            animation: nmt-pop-in 0.15s ease;
        }
        #notion-math-tool.hidden {
            display: none;
        }

        @keyframes nmt-pop-in {
            from { opacity: 0; transform: scale(0.92); }
            to   { opacity: 1; transform: scale(1); }
        }

        /* --- Header --- */
        #nmt-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-bottom: 1px solid rgb(233, 233, 231);
            user-select: none;
        }
        #nmt-header-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px; height: 22px;
            border-radius: 4px;
            background: rgb(245, 244, 241);
            flex-shrink: 0;
            font-family: "Times New Roman", "Latin Modern Math", serif;
            font-size: 15px;
            color: rgb(55, 53, 47);
            line-height: 1;
        }
        #nmt-header-title {
            font-size: 14px;
            font-weight: 500;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .nmt-header-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px; height: 22px;
            border-radius: 4px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: rgba(55, 53, 47, 0.35);
            transition: background 0.1s, color 0.1s;
            flex-shrink: 0;
            padding: 0;
        }
        .nmt-header-btn:hover { background: rgb(239, 238, 235); color: rgb(55, 53, 47); }
        .nmt-header-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; }
        #nmt-fold-btn { margin-left: auto; }

        /* --- Buttons --- */
        #nmt-actions { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
        .nmt-btn {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            width: 100%; padding: 6px 12px; border-radius: 6px; border: none;
            font-family: inherit; font-size: 14px; font-weight: 500;
            cursor: pointer; transition: background 0.1s; line-height: 1.5;
        }
        .nmt-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
        #nmt-scan-btn { background: rgb(245, 244, 241); color: rgb(55, 53, 47); }
        #nmt-scan-btn:hover { background: rgb(239, 238, 235); }
        #nmt-convert-btn { background: rgb(35, 131, 226); color: white; }
        #nmt-convert-btn:hover { background: rgb(0, 113, 210); }
        .nmt-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }

        /* --- Status --- */
        #nmt-status-wrap { padding: 0 12px 8px; }
        #nmt-status {
            display: flex; align-items: center; gap: 6px;
            padding: 5px 10px; border-radius: 6px;
            background: rgb(245, 244, 241);
            font-size: 12px; color: rgba(55, 53, 47, 0.65);
            line-height: 1.4; min-height: 18px; transition: background 0.15s;
        }
        #nmt-status.success { background: rgb(219, 237, 219); color: rgb(28, 56, 41); }
        #nmt-status.working { background: rgb(227, 226, 224); color: rgb(55, 53, 47); }
        #nmt-status.error   { background: rgb(253, 235, 236); color: rgb(93, 23, 21); }
        #nmt-status-dot {
            width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
            background: rgba(55, 53, 47, 0.25); transition: background 0.15s;
        }
        #nmt-status.success #nmt-status-dot { background: rgb(68, 131, 97); }
        #nmt-status.working #nmt-status-dot { background: rgb(35, 131, 226); animation: nmt-pulse 1s ease-in-out infinite; }
        #nmt-status.error #nmt-status-dot { background: rgb(212, 76, 71); }
        @keyframes nmt-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }

        /* --- Log --- */
        #nmt-log-wrap {
            border-top: 1px solid rgb(233, 233, 231);
            max-height: 0; overflow: hidden; transition: max-height 0.2s ease;
        }
        #nmt-log-wrap.open { max-height: 200px; }
        #nmt-log-toggle {
            display: flex; align-items: center; gap: 4px;
            width: 100%; padding: 6px 12px; border: none; background: transparent;
            cursor: pointer; font-family: inherit; font-size: 12px;
            color: rgba(55, 53, 47, 0.5); transition: color 0.1s;
        }
        #nmt-log-toggle:hover { color: rgb(55, 53, 47); }
        #nmt-log-toggle svg {
            width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2;
            transition: transform 0.2s ease;
        }
        #nmt-log-wrap.open #nmt-log-toggle svg { transform: rotate(90deg); }
        #nmt-log {
            max-height: 160px; overflow-y: auto; padding: 0 12px 8px;
            scrollbar-width: thin; scrollbar-color: rgb(225,225,225) transparent;
        }
        #nmt-log::-webkit-scrollbar { width: 4px; }
        #nmt-log::-webkit-scrollbar-thumb { background: rgb(225,225,225); border-radius: 4px; }
        .nmt-log-entry {
            padding: 3px 0; font-size: 11px; line-height: 1.5;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: rgba(55, 53, 47, 0.5); border-bottom: 1px solid rgb(241, 241, 239);
        }
        .nmt-log-entry:last-child { border-bottom: none; }
        .nmt-log-entry.found { color: rgb(68, 131, 97); }
        .nmt-log-entry.warn  { color: rgb(203, 145, 47); }

        /* --- Dark mode --- */
        .notion-dark-theme #nmt-fab, .dark #nmt-fab {
            background: rgb(37, 37, 37); color: rgba(255,255,255,0.81);
            box-shadow: rgba(15,15,15,0.1) 0px 0px 0px 1px, rgba(15,15,15,0.2) 0px 3px 6px, rgba(15,15,15,0.4) 0px 9px 24px;
        }
        .notion-dark-theme #notion-math-tool, .dark #notion-math-tool {
            background: rgb(37,37,37); color: rgba(255,255,255,0.81);
            box-shadow: rgba(15,15,15,0.1) 0px 0px 0px 1px, rgba(15,15,15,0.2) 0px 3px 6px, rgba(15,15,15,0.4) 0px 9px 24px;
        }
        .notion-dark-theme #nmt-header, .dark #nmt-header { border-color: rgb(63,63,63); }
        .notion-dark-theme #nmt-header-title, .dark #nmt-header-title { color: rgba(255,255,255,0.81); }
        .notion-dark-theme #nmt-header-icon, .dark #nmt-header-icon { background: rgb(55,55,55); color: rgba(255,255,255,0.81); }
        .notion-dark-theme .nmt-header-btn, .dark .nmt-header-btn { color: rgba(255,255,255,0.3); }
        .notion-dark-theme .nmt-header-btn:hover, .dark .nmt-header-btn:hover { background: rgb(55,55,55); color: rgba(255,255,255,0.81); }
        .notion-dark-theme #nmt-scan-btn, .dark #nmt-scan-btn { background: rgb(55,55,55); color: rgba(255,255,255,0.81); }
        .notion-dark-theme #nmt-scan-btn:hover, .dark #nmt-scan-btn:hover { background: rgb(63,63,63); }
        .notion-dark-theme #nmt-status, .dark #nmt-status { background: rgb(55,55,55); color: rgba(255,255,255,0.5); }
        .notion-dark-theme #nmt-status.success, .dark #nmt-status.success { background: rgb(36,61,48); color: rgb(127,195,145); }
        .notion-dark-theme #nmt-status.working, .dark #nmt-status.working { background: rgb(45,55,72); color: rgb(129,176,223); }
        .notion-dark-theme #nmt-status.error, .dark #nmt-status.error { background: rgb(66,34,34); color: rgb(223,132,129); }
        .notion-dark-theme #nmt-log-wrap, .dark #nmt-log-wrap { border-color: rgb(63,63,63); }
        .notion-dark-theme #nmt-log-toggle, .dark #nmt-log-toggle { color: rgba(255,255,255,0.3); }
        .notion-dark-theme #nmt-log-toggle:hover, .dark #nmt-log-toggle:hover { color: rgba(255,255,255,0.7); }
        .notion-dark-theme .nmt-log-entry, .dark .nmt-log-entry { color: rgba(255,255,255,0.35); border-color: rgb(55,55,55); }
        .notion-dark-theme .nmt-log-entry.found, .dark .nmt-log-entry.found { color: rgb(127,195,145); }
        .notion-dark-theme .nmt-log-entry.warn, .dark .nmt-log-entry.warn { color: rgb(218,178,100); }
        .notion-dark-theme #nmt-log::-webkit-scrollbar-thumb, .dark #nmt-log::-webkit-scrollbar-thumb { background: rgb(63,63,63); }
    `);

    // --- FAB (collapsed state) ---
    const fab = document.createElement('button');
    fab.id = 'nmt-fab';
    fab.textContent = 'Σ';
    fab.title = 'Math Converter';
    document.body.appendChild(fab);

    // --- Panel (expanded state) ---
    const panel = document.createElement('div');
    panel.id = 'notion-math-tool';
    panel.classList.add('hidden');
    panel.innerHTML = `
        <div id="nmt-header">
            <div id="nmt-header-icon">Σ</div>
            <span id="nmt-header-title">Math Converter</span>
            <button id="nmt-fold-btn" class="nmt-header-btn" title="Minimize">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button id="nmt-close-btn" class="nmt-header-btn" title="Close">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div id="nmt-actions">
            <button id="nmt-scan-btn" class="nmt-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Scan page
            </button>
            <button id="nmt-convert-btn" class="nmt-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Convert all
            </button>
        </div>
        <div id="nmt-status-wrap">
            <div id="nmt-status">
                <div id="nmt-status-dot"></div>
                <span id="nmt-status-text">Ready</span>
            </div>
        </div>
        <div id="nmt-log-wrap">
            <button id="nmt-log-toggle">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                Log
            </button>
            <div id="nmt-log"></div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- State toggling ---
    function expand() {
        fab.classList.add('hidden');
        panel.classList.remove('hidden');
    }
    function collapse() {
        panel.classList.add('hidden');
        fab.classList.remove('hidden');
    }
    function closeAll() {
        panel.classList.add('hidden');
        fab.classList.add('hidden');
    }

    fab.onclick = expand;
    document.getElementById('nmt-fold-btn').onclick = collapse;
    document.getElementById('nmt-close-btn').onclick = closeAll;
    document.getElementById('nmt-log-toggle').onclick = () => {
        document.getElementById('nmt-log-wrap').classList.toggle('open');
    };

    // --- Status & log helpers ---
    const statusEl  = document.getElementById('nmt-status');
    const statusTxt = document.getElementById('nmt-status-text');
    const logEl     = document.getElementById('nmt-log');
    const logWrap   = document.getElementById('nmt-log-wrap');
    const convertBtn = document.getElementById('nmt-convert-btn');
    const scanBtn    = document.getElementById('nmt-scan-btn');

    function setStatus(msg, type = '') { statusTxt.innerText = msg; statusEl.className = type; }
    function log(msg, type = '') {
        console.log('[NotionMath]', msg);
        const d = document.createElement('div');
        d.className = 'nmt-log-entry' + (type ? ' ' + type : '');
        d.textContent = msg;
        logEl.prepend(d);
        while (logEl.children.length > 40) logEl.lastChild.remove();
        if (!logWrap.classList.contains('open')) logWrap.classList.add('open');
    }

    // --- Core helpers ---
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function clean(t) { return t.replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, '').trim(); }

    // Get text content of a block, excluding any already-converted inline equation elements
    function getScannableText(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('[class*="katex"], [class*="notion-equation"], [data-token-index]').forEach(eq => eq.remove());
        return clean(clone.textContent);
    }

    function selectContentsOf(el) {
        const s = window.getSelection(), r = document.createRange();
        r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r);
    }

    function getPageBlocks() {
        const page = document.querySelector('.notion-page-content')
            || document.querySelector('[class*="notion-page-content"]')
            || document.querySelector('.notion-scroller');
        if (!page) return [];
        return Array.from(page.querySelectorAll('[contenteditable="true"]')).filter(el => {
            if (el.closest('.notion-code-block')) return false;
            if (el.closest('.notion-equation-block')) return false;
            if (el.closest('[class*="katex"]')) return false;
            if (el.closest('#notion-math-tool')) return false;
            if (el.querySelector('[contenteditable="true"]')) return false;
            return true;
        });
    }

    function pressKey(el, key, keyCode, extra = {}) {
        const o = { key, keyCode, code: key, which: keyCode, bubbles: true, cancelable: true, ...extra };
        el.dispatchEvent(new KeyboardEvent('keydown', o));
        el.dispatchEvent(new KeyboardEvent('keypress', o));
        el.dispatchEvent(new KeyboardEvent('keyup', o));
    }

    // --- Scanning ---
    // Regex: match $...$ but not $$...$$. Captures the content between single dollars.
    const INLINE_MATH_RE = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
    // Regex: match \(...\) LaTeX inline math delimiters
    const INLINE_PAREN_RE = /\\\((.+?)\\\)/g;

    function findInlineMath(text) {
        const matches = [];
        let m;
        INLINE_MATH_RE.lastIndex = 0;
        while ((m = INLINE_MATH_RE.exec(text)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, math: m[1].trim(), full: m[0] });
        }
        INLINE_PAREN_RE.lastIndex = 0;
        while ((m = INLINE_PAREN_RE.exec(text)) !== null) {
            const s = m.index, e = m.index + m[0].length;
            if (!matches.some(x => (s >= x.start && s < x.end) || (e > x.start && e <= x.end))) {
                matches.push({ start: s, end: e, math: m[1].trim(), full: m[0] });
            }
        }
        matches.sort((a, b) => a.start - b.start);
        return matches;
    }

    function scanForMath() {
        const blocks = getPageBlocks(), groups = [], used = new Set();
        for (let i = 0; i < blocks.length; i++) {
            if (used.has(i)) continue;
            const text = getScannableText(blocks[i]);

            if (text === '[') {
                let lines = [], end = -1;
                for (let j = i + 1; j < blocks.length && j < i + 40; j++) {
                    const t = clean(blocks[j].textContent);
                    if (t === ']') { end = j; break; }
                    lines.push(t);
                }
                if (end !== -1 && lines.length) {
                    groups.push({ type: 'bracket-multi', startIdx: i, endIdx: end, math: lines.join(' '), blockCount: end - i + 1 });
                    for (let k = i; k <= end; k++) used.add(k);
                    continue;
                }
            }
            if (text.startsWith('[') && text.endsWith(']') && text.length > 4) {
                const inner = text.slice(1, -1).trim();
                if (/[\\{}^_=]/.test(inner)) {
                    groups.push({ type: 'bracket-single', startIdx: i, endIdx: i, math: inner, blockCount: 1 });
                    used.add(i); continue;
                }
            }
            if (text === '\\[') {
                let lines = [], end = -1;
                for (let j = i + 1; j < blocks.length && j < i + 40; j++) {
                    const t = clean(blocks[j].textContent);
                    if (t === '\\]') { end = j; break; }
                    lines.push(t);
                }
                if (end !== -1 && lines.length) {
                    groups.push({ type: 'backslash-bracket-multi', startIdx: i, endIdx: end, math: lines.join(' '), blockCount: end - i + 1 });
                    for (let k = i; k <= end; k++) used.add(k);
                    continue;
                }
            }
            if (text.startsWith('\\[') && text.endsWith('\\]') && text.length > 4) {
                const inner = text.slice(2, -2).trim();
                groups.push({ type: 'backslash-bracket-single', startIdx: i, endIdx: i, math: inner, blockCount: 1 });
                used.add(i); continue;
            }
            if (text === '$$') {
                let lines = [], end = -1;
                for (let j = i + 1; j < blocks.length && j < i + 40; j++) {
                    const t = clean(blocks[j].textContent);
                    if (t === '$$') { end = j; break; }
                    lines.push(t);
                }
                if (end !== -1 && lines.length) {
                    groups.push({ type: 'dollar-multi', startIdx: i, endIdx: end, math: lines.join(' '), blockCount: end - i + 1 });
                    for (let k = i; k <= end; k++) used.add(k);
                    continue;
                }
            }
            if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4) {
                const inner = text.slice(2, -2).trim();
                groups.push({ type: 'dollar-single', startIdx: i, endIdx: i, math: inner, blockCount: 1 });
                used.add(i); continue;
            }

            // Inline math: $...$ within a text block (converted via Notion API, all at once)
            const inlineMatches = findInlineMath(text);
            if (inlineMatches.length > 0) {
                groups.push({ type: 'inline', startIdx: i, endIdx: i, math: inlineMatches.map(m => m.math).join(', '), blockCount: 1, inlineCount: inlineMatches.length });
                used.add(i); continue;
            }
        }
        return { blocks, groups };
    }

    // --- Conversion ---
    async function deleteBlock(block) {
        block.focus(); await sleep(ACTION_DELAY);
        selectContentsOf(block); await sleep(ACTION_DELAY);
        document.execCommand('delete'); await sleep(ACTION_DELAY);
        pressKey(document.activeElement, 'Backspace', 8); await sleep(ACTION_DELAY + 150);
    }

    async function typeAsMathBlock(block, math) {
        block.focus(); await sleep(ACTION_DELAY);
        selectContentsOf(block); await sleep(ACTION_DELAY);
        document.execCommand('delete'); await sleep(ACTION_DELAY);
        document.execCommand('insertText', false, '/math'); await sleep(MENU_DELAY);
        pressKey(document.activeElement, 'Enter', 13); await sleep(500);
        document.execCommand('insertText', false, math); await sleep(ACTION_DELAY);
        pressKey(document.activeElement, 'Escape', 27); await sleep(ACTION_DELAY);
    }

    // --- Notion API for inline equations ---
    // Slash commands can only create block-level equations, not inline.
    // So we use Notion's internal API to directly modify the block's rich text.

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    async function notionApi(endpoint, body) {
        const res = await fetch(`/api/v3/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!res.ok) throw new Error(`API ${endpoint}: ${res.status}`);
        return res.json();
    }

    async function getBlockRecord(blockId) {
        const data = await notionApi('syncRecordValues', {
            requests: [{ pointer: { table: 'block', id: blockId }, version: -1 }]
        });
        return data.recordMap?.block?.[blockId]?.value;
    }

    // Replace $...$ and \(...\) patterns in Notion's rich text title array.
    // Each segment is ["text"] or ["text", [["format", "value"], ...]].
    // Inline equations are ["⁍", [["e", "latex"]]].
    function replaceInlineMathInTitle(title) {
        const DOLLAR_RE = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
        const PAREN_RE = /\\\((.+?)\\\)/g;
        const newTitle = [];
        let changed = false;

        for (const segment of title) {
            const text = segment[0];
            const formats = segment.length > 1 ? segment[1] : null;

            // Don't touch segments that are already equations
            if (formats && formats.some(f => f[0] === 'e')) {
                newTitle.push(segment);
                continue;
            }

            // Collect all inline math matches ($...$ and \(...\))
            const allMatches = [];
            let match;
            DOLLAR_RE.lastIndex = 0;
            while ((match = DOLLAR_RE.exec(text)) !== null) {
                allMatches.push({ start: match.index, end: match.index + match[0].length, math: match[1].trim() });
            }
            PAREN_RE.lastIndex = 0;
            while ((match = PAREN_RE.exec(text)) !== null) {
                const s = match.index, e = match.index + match[0].length;
                if (!allMatches.some(x => (s >= x.start && s < x.end) || (e > x.start && e <= x.end))) {
                    allMatches.push({ start: s, end: e, math: match[1].trim() });
                }
            }
            allMatches.sort((a, b) => a.start - b.start);

            let lastIndex = 0;
            const parts = [];

            for (const m of allMatches) {
                changed = true;
                if (m.start > lastIndex) {
                    const before = text.slice(lastIndex, m.start);
                    parts.push(formats ? [before, formats.map(f => [...f])] : [before]);
                }
                parts.push(['\u204D', [['e', m.math]]]);
                lastIndex = m.end;
            }

            if (lastIndex < text.length) {
                const after = text.slice(lastIndex);
                parts.push(formats ? [after, formats.map(f => [...f])] : [after]);
            }

            if (parts.length > 0) {
                newTitle.push(...parts);
            } else {
                newTitle.push(segment);
            }
        }

        return { newTitle, changed };
    }

    async function convertInlineMathViaApi(blockEl) {
        const container = blockEl.closest('[data-block-id]');
        if (!container) throw new Error('No data-block-id on block element');
        const blockId = container.getAttribute('data-block-id');

        const record = await getBlockRecord(blockId);
        if (!record) throw new Error('Block record not found');

        const title = record.properties?.title;
        if (!title) throw new Error('No title property on block');

        const { newTitle, changed } = replaceInlineMathInTitle(title);
        if (!changed) return false;

        await notionApi('saveTransactions', {
            requestId: generateUUID(),
            transactions: [{
                id: generateUUID(),
                operations: [{
                    pointer: { table: 'block', id: blockId, spaceId: record.space_id },
                    path: ['properties', 'title'],
                    command: 'set',
                    args: newTitle
                }]
            }]
        });

        return true;
    }

    async function convertOneGroup() {
        const { blocks, groups } = scanForMath();
        if (!groups.length) return false;
        const g = groups[0];
        const extra = g.inlineCount ? ` (${g.inlineCount} equations)` : '';
        log(`${g.type} · ${g.blockCount} block(s)${extra}`, 'found');
        log(`  ${g.math.slice(0, 70)}${g.math.length > 70 ? '…' : ''}`);

        if (g.type === 'inline') {
            await convertInlineMathViaApi(blocks[g.startIdx]);
            await sleep(SETTLE_DELAY); // wait for Notion to re-render
        } else if (g.blockCount === 1) {
            await typeAsMathBlock(blocks[g.startIdx], g.math);
        } else {
            for (let j = g.endIdx; j > g.startIdx; j--) {
                const fresh = getPageBlocks();
                if (j < fresh.length) await deleteBlock(fresh[j]);
                await sleep(150);
            }
            const fresh = getPageBlocks();
            if (g.startIdx < fresh.length) await typeAsMathBlock(fresh[g.startIdx], g.math);
        }
        return true;
    }

    // --- Run ---
    async function runScan() {
        scanBtn.disabled = true; logEl.innerHTML = '';
        setStatus('Scanning…', 'working');
        const { blocks, groups } = scanForMath();
        log(`${blocks.length} editable blocks`);
        if (!groups.length) {
            setStatus('No math found', '');
            for (let i = 0; i < Math.min(blocks.length, 10); i++) {
                const c = clean(blocks[i].textContent);
                log(`[${i}] ${c.slice(0, 80)}${c.length > 80 ? '…' : ''}`);
            }
        } else {
            for (const g of groups) log(`${g.type} [${g.startIdx}→${g.endIdx}]: ${g.math.slice(0, 80)}`, 'found');
            setStatus(`${groups.length} math block(s) found`, 'success');
        }
        scanBtn.disabled = false;
    }

    async function runConvert() {
        convertBtn.disabled = scanBtn.disabled = true;
        logEl.innerHTML = ''; setStatus('Converting…', 'working');
        let n = 0, s = 0;
        while (s++ < 50) {
            if (!(await convertOneGroup())) break;
            n++; setStatus(`Converted ${n}…`, 'working'); await sleep(SETTLE_DELAY);
        }
        setStatus(n ? `${n} block(s) converted` : 'No math blocks found', n ? 'success' : '');
        log(`Done — ${n} converted`);
        convertBtn.disabled = scanBtn.disabled = false;
    }

    scanBtn.onclick = runScan;
    convertBtn.onclick = runConvert;

})();