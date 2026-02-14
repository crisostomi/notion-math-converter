// ==UserScript==
// @name         Notion Math Converter v6.1
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  Finds multi-line [ ... ] and $$ ... $$ math blocks in Notion and converts them to equation blocks.
// @author       You
// @match        https://www.notion.so/*
// @match        https://www.notion.site/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // --- CONFIG ---
    const MENU_DELAY = 900;      // ms to wait for Notion's slash command menu
    const ACTION_DELAY = 80;     // ms between small actions
    const SETTLE_DELAY = 500;    // ms to let the DOM settle after a conversion

    // --- UI SETUP ---
    const existing = document.getElementById('notion-math-tool-v6');
    if (existing) existing.remove();

    GM_addStyle(`
        #notion-math-tool-v6 {
            position: fixed; top: 60px; right: 20px; z-index: 99999;
            background: #1e1e2e; color: #cdd6f4; border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4); width: 170px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; text-align: center;
            user-select: none;
        }
        #nmt-header { padding: 8px 10px; font-weight: 600; border-bottom: 1px solid #45475a; font-size: 12px; }
        .nmt-btn {
            background: #cba6f7; color: #1e1e2e; border: none; padding: 10px;
            width: 100%; cursor: pointer; font-weight: 700; font-size: 13px;
            transition: background 0.15s;
        }
        .nmt-btn:hover { background: #b4befe; }
        .nmt-btn:disabled { background: #585b70; color: #7f849c; cursor: default; }
        #nmt-scan-btn {
            background: #45475a; color: #cdd6f4; font-weight: 500; font-size: 11px; padding: 7px;
            border: none; width: 100%; cursor: pointer;
        }
        #nmt-scan-btn:hover { background: #585b70; }
        #nmt-status { padding: 6px 8px; font-size: 10px; color: #a6adc8; min-height: 14px; }
        #nmt-log { max-height: 150px; overflow-y: auto; text-align: left; padding: 0 8px 6px; font-size: 9px; color: #7f849c; }
        #nmt-log div { padding: 1px 0; border-bottom: 1px solid #313244; }
    `);

    const uiContainer = document.createElement('div');
    uiContainer.id = 'notion-math-tool-v6';
    uiContainer.innerHTML = `
        <div id="nmt-header">Math Converter v6.1</div>
        <button id="nmt-scan-btn">SCAN (dry run)</button>
        <button id="nmt-convert-btn" class="nmt-btn">CONVERT</button>
        <div id="nmt-status">Idle</div>
        <div id="nmt-log"></div>
    `;
    document.body.appendChild(uiContainer);

    const statusEl = document.getElementById('nmt-status');
    const logEl = document.getElementById('nmt-log');
    const convertBtn = document.getElementById('nmt-convert-btn');
    const scanBtn = document.getElementById('nmt-scan-btn');

    function setStatus(msg) { statusEl.innerText = msg; }
    function log(msg) {
        console.log('[NotionMath]', msg);
        const d = document.createElement('div');
        d.textContent = msg;
        logEl.prepend(d);
        while (logEl.children.length > 40) logEl.lastChild.remove();
    }

    // --- HELPERS ---

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /** Strip invisible Unicode junk that Notion injects */
    function clean(text) {
        return text.replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, '').trim();
    }

    /**
     * CRITICAL FIX: Select only the contents of a specific element,
     * NOT the whole page. document.execCommand('selectAll') selects
     * the entire Notion page which destroys everything.
     */
    function selectContentsOf(element) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /** Get the closest Notion block wrapper for a contenteditable element */
    function getNotionBlock(el) {
        // Notion wraps each block in a div with data-block-id
        return el.closest('[data-block-id]') || el;
    }

    /** Get ordered list of leaf contenteditable blocks inside the page */
    function getPageBlocks() {
        const page = document.querySelector('.notion-page-content')
            || document.querySelector('[class*="notion-page-content"]')
            || document.querySelector('.notion-scroller');
        if (!page) {
            log('⚠ Could not find page content container');
            return [];
        }

        const all = Array.from(page.querySelectorAll('[contenteditable="true"]'));

        return all.filter(el => {
            if (el.closest('.notion-code-block')) return false;
            if (el.closest('.notion-equation-block')) return false;
            if (el.closest('[class*="katex"]')) return false;
            // Skip our own UI
            if (el.closest('#notion-math-tool-v6')) return false;
            // Only leaf editables
            const nested = el.querySelector('[contenteditable="true"]');
            if (nested) return false;
            return true;
        });
    }

    /** Dispatch keyboard events properly */
    function pressKey(el, key, keyCode, extra = {}) {
        const baseOpts = {
            key, keyCode, code: key, which: keyCode,
            bubbles: true, cancelable: true, ...extra
        };
        el.dispatchEvent(new KeyboardEvent('keydown', baseOpts));
        el.dispatchEvent(new KeyboardEvent('keypress', baseOpts));
        el.dispatchEvent(new KeyboardEvent('keyup', baseOpts));
    }

    // --- SCANNING ---

    function scanForMath() {
        const blocks = getPageBlocks();
        const groups = [];
        const used = new Set();

        for (let i = 0; i < blocks.length; i++) {
            if (used.has(i)) continue;
            const text = clean(blocks[i].textContent);

            // --- Multi-line [ ... ] ---
            if (text === '[') {
                let mathLines = [];
                let endIdx = -1;
                for (let j = i + 1; j < blocks.length && j < i + 40; j++) {
                    const t = clean(blocks[j].textContent);
                    if (t === ']') { endIdx = j; break; }
                    mathLines.push(t);
                }
                if (endIdx !== -1 && mathLines.length > 0) {
                    const math = mathLines.join(' ');
                    groups.push({ type: 'bracket-multi', startIdx: i, endIdx, math, blockCount: endIdx - i + 1 });
                    for (let k = i; k <= endIdx; k++) used.add(k);
                    continue;
                }
            }

            // --- Single-line [ ... ] ---
            if (text.startsWith('[') && text.endsWith(']') && text.length > 4) {
                const inner = text.slice(1, -1).trim();
                if (/[\\{}^_=]/.test(inner) || /\\[a-zA-Z]/.test(inner)) {
                    groups.push({ type: 'bracket-single', startIdx: i, endIdx: i, math: inner, blockCount: 1 });
                    used.add(i);
                    continue;
                }
            }

            // --- Multi-line $$ ... $$ ---
            if (text === '$$') {
                let mathLines = [];
                let endIdx = -1;
                for (let j = i + 1; j < blocks.length && j < i + 40; j++) {
                    const t = clean(blocks[j].textContent);
                    if (t === '$$') { endIdx = j; break; }
                    mathLines.push(t);
                }
                if (endIdx !== -1 && mathLines.length > 0) {
                    const math = mathLines.join(' ');
                    groups.push({ type: 'dollar-multi', startIdx: i, endIdx, math, blockCount: endIdx - i + 1 });
                    for (let k = i; k <= endIdx; k++) used.add(k);
                    continue;
                }
            }

            // --- Single-line $$ ... $$ ---
            if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4) {
                const inner = text.slice(2, -2).trim();
                groups.push({ type: 'dollar-single', startIdx: i, endIdx: i, math: inner, blockCount: 1 });
                used.add(i);
                continue;
            }
        }

        return { blocks, groups };
    }

    // --- CONVERSION ---

    /** Safely clear a single block's text and delete the empty block via Backspace */
    async function deleteBlock(block) {
        block.focus();
        await sleep(ACTION_DELAY);

        // Select ONLY this block's contents (not the whole page!)
        selectContentsOf(block);
        await sleep(ACTION_DELAY);

        // Delete just the selected text within this block
        document.execCommand('delete');
        await sleep(ACTION_DELAY);

        // Now the block is empty — Backspace removes it and merges with above
        pressKey(document.activeElement, 'Backspace', 8);
        await sleep(ACTION_DELAY + 150);
    }

    /** Convert a single block into a Notion equation block */
    async function typeAsMathBlock(block, mathContent) {
        block.focus();
        await sleep(ACTION_DELAY);

        // Select ONLY this block's contents
        selectContentsOf(block);
        await sleep(ACTION_DELAY);

        // Delete just the selected content
        document.execCommand('delete');
        await sleep(ACTION_DELAY);

        // Type /math to trigger Notion's slash command
        document.execCommand('insertText', false, '/math');
        await sleep(MENU_DELAY);

        // Press Enter to confirm "Block equation"
        pressKey(document.activeElement, 'Enter', 13);
        await sleep(500);

        // Type the LaTeX
        document.execCommand('insertText', false, mathContent);
        await sleep(ACTION_DELAY);

        // Press Escape to close the equation editor
        pressKey(document.activeElement, 'Escape', 27);
        await sleep(ACTION_DELAY);
    }

    /** Convert one math group. Returns true if it did something. */
    async function convertOneGroup() {
        const { blocks, groups } = scanForMath();
        if (groups.length === 0) return false;

        const group = groups[0];
        log(`Converting: ${group.type} (${group.blockCount} blocks)`);
        log(`  Math: "${group.math.slice(0, 70)}${group.math.length > 70 ? '...' : ''}"`);

        if (group.blockCount === 1) {
            await typeAsMathBlock(blocks[group.startIdx], group.math);
        } else {
            // Multi-block: delete extra blocks bottom-up, then convert the first
            for (let j = group.endIdx; j > group.startIdx; j--) {
                log(`  Deleting block ${j}...`);
                // Re-scan to get fresh block references (DOM shifts after each delete)
                const fresh = getPageBlocks();
                if (j < fresh.length) {
                    await deleteBlock(fresh[j]);
                } else {
                    log(`  ⚠ Block ${j} no longer exists, skipping`);
                }
                await sleep(150);
            }

            // Re-scan one more time to convert the remaining first block
            const freshAfter = getPageBlocks();
            if (group.startIdx < freshAfter.length) {
                await typeAsMathBlock(freshAfter[group.startIdx], group.math);
            } else {
                log('  ⚠ Start block disappeared');
            }
        }

        return true;
    }

    // --- RUN ---

    async function runScan() {
        scanBtn.disabled = true;
        logEl.innerHTML = '';
        setStatus('Scanning...');

        const { blocks, groups } = scanForMath();
        log(`Found ${blocks.length} editable blocks on page`);

        if (groups.length === 0) {
            log('No math blocks detected.');
            setStatus('No math found.');
            for (let i = 0; i < Math.min(blocks.length, 10); i++) {
                const c = clean(blocks[i].textContent);
                log(`  [${i}]: "${c.slice(0, 80)}${c.length > 80 ? '...' : ''}"`);
            }
        } else {
            for (const g of groups) {
                log(`✓ ${g.type} [blocks ${g.startIdx}→${g.endIdx}]: ${g.math.slice(0, 80)}`);
            }
            setStatus(`Found ${groups.length} math block(s). Hit CONVERT.`);
        }

        scanBtn.disabled = false;
    }

    async function runConvert() {
        convertBtn.disabled = true;
        scanBtn.disabled = true;
        logEl.innerHTML = '';
        setStatus('Converting...');

        let converted = 0;
        let safety = 0;

        while (safety < 50) {
            safety++;
            const did = await convertOneGroup();
            if (!did) break;
            converted++;
            setStatus(`Converted ${converted}, scanning for more...`);
            await sleep(SETTLE_DELAY);
        }

        setStatus(converted > 0 ? `Done! Converted ${converted} block(s).` : 'No math blocks found.');
        log(`Finished. Total converted: ${converted}`);
        convertBtn.disabled = false;
        scanBtn.disabled = false;
    }

    scanBtn.onclick = runScan;
    convertBtn.onclick = runConvert;

})();