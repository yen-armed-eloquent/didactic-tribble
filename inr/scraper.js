const fs = require('fs');
const axios = require('axios');

// GitHub Secrets se accounts uthana
const allAccounts = JSON.parse(process.env.ACCOUNTS_JSON || "[]");
const NODE_INDEX = parseInt(process.env.NODE_INDEX || "0");
const TOTAL_NODES = parseInt(process.env.TOTAL_NODES || "4");

if (allAccounts.length === 0) {
    console.error("❌ ACCOUNTS_JSON missing!");
    process.exit(1);
}

const currentCookies = allAccounts[NODE_INDEX % allAccounts.length];
const cookieString = currentCookies.map(c => `${c.name}=${c.value}`).join('; ');
const csrfToken = currentCookies.find(c => c.name === 'csrftoken')?.value || '';

const headers = {
    'authority': 'www.instagram.com',
    'accept': '*/*',
    'cookie': cookieString,
    'x-csrftoken': csrfToken,
    'x-ig-app-id': '936619743392459',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const extractShortcode = (url) => { const match = url.match(/(?:p|reel)\/([^\/?#&]+)/); return match ? match[1] : url.trim(); };

async function fetchComments(shortcode, cursor = null) {
    try {
        let variables = JSON.stringify({ shortcode: shortcode, first: 50, after: cursor });
        let url = `https://www.instagram.com/graphql/query/?query_hash=bc3296d1ce80a24b1b6e40b1e72903f5&variables=${encodeURIComponent(variables)}`;
        const res = await axios.get(url, { headers });
        return res.data?.data?.shortcode_media?.edge_media_to_parent_comment || null;
    } catch (e) { return null; }
}

async function scrapeFullPost(shortcode, nodeIdx, workerId, linkIdx, totalLinks) {
    let allComments = [];
    let hasNextPage = true;
    let cursor = null;
    let targetComments = 0;
    let retryCount = 0;
    const MAX_RETRIES = 10;
    const LIMIT = 10000;

    console.log(`\n🚀 [POD-${nodeIdx}] Starting Link ${linkIdx}/${totalLinks} | Post: ${shortcode}`);

    while (hasNextPage && allComments.length < LIMIT && retryCount < MAX_RETRIES) {
        const data = await fetchComments(shortcode, cursor);
        
        if (!data || !data.edges || data.edges.length === 0) {
            retryCount++;
            console.log(`⚠️ [POD-${nodeIdx}] Retry ${retryCount}/10 for ${shortcode}`);
            await wait(8000);
            continue; 
        }

        targetComments = data.count || targetComments;
        
        // Yahan hum wo "Rich Data" extract kar rahe hain jo aapne dataset mein dikhaya
        const mapped = data.edges.map(e => ({
            id: e.node.id,
            text: e.node.text,
            created_at: e.node.created_at,
            did_report_as_spam: e.node.did_report_as_spam,
            owner: {
                id: e.node.owner.id,
                username: e.node.owner.username,
                profile_pic_url: e.node.owner.profile_pic_url, // Avatar Link
                is_verified: e.node.owner.is_verified
            },
            viewer_has_liked: e.node.viewer_has_liked,
            comment_like_count: e.node.edge_liked_by?.count || 0,
            // Agar replies bhi chahiye hon toh wo bhi yahan se nikal sakte hain
            reply_count: e.node.edge_threaded_comments?.count || 0
        }));
        
        allComments.push(...mapped);

        // Aapki requested screen tracking logic
        console.log(`📊 [POD-${nodeIdx} | W-${workerId}] Progress: ${linkIdx}/${totalLinks} | ${shortcode} | Count: ${allComments.length}/${targetComments} | Goal: ${LIMIT}`);

        hasNextPage = data.page_info.has_next_page;
        cursor = data.page_info.end_cursor;
        
        if (allComments.length >= targetComments) break;
        await wait(3500); 
    }

    return { 
        shortcode: shortcode, 
        total_comments_on_post: targetComments, 
        fetched_at: new Date().toISOString(),
        comments: allComments // Ye poora dataset banayega
    };
}

async function runEngine(links, nodeIdx, batchFolder) {
    let currentIndex = 0;
    const TARGET_DIR = `/data/output/${batchFolder}`;
    if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });
    const DATASET_FILE = `${TARGET_DIR}/Dataset_Pod_${nodeIdx}.json`;
    fs.writeFileSync(DATASET_FILE, JSON.stringify([]));

    async function worker(workerId) {
        while (currentIndex < links.length) {
            const currentIdx = currentIndex++;
            const sc = links[currentIdx];
            const fullData = await scrapeFullPost(sc, nodeIdx, workerId, currentIdx + 1, links.length);
            if (fullData) {
                const currentData = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf-8'));
                currentData.push(fullData);
                fs.writeFileSync(DATASET_FILE, JSON.stringify(currentData, null, 2));
            }
            await wait(6000);
        }
    }
    await Promise.all([worker(1), worker(2), worker(3)]);
}

(async () => {
    const BATCH_FOLDER = process.env.BATCH_FOLDER || "Default";
    try {
        const fileContent = fs.readFileSync('/app/links.txt', 'utf-8');
        const uniqueLinks = [...new Set(fileContent.split(/[\n\s,]+/).filter(Boolean).map(extractShortcode))];
        const myLinks = uniqueLinks.filter((_, i) => i % TOTAL_NODES === NODE_INDEX);
        console.log(`👤 Pod ${NODE_INDEX} online. Account: ${NODE_INDEX % allAccounts.length}. Links: ${myLinks.length}`);
        await runEngine(myLinks, NODE_INDEX, BATCH_FOLDER);
    } catch (e) { console.error(e); }
})();
