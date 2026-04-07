const fs = require('fs');
const axios = require('axios');

// 1. Webshare Proxies List
const proxyList = [
    "31.59.20.176:6754:bacgvrmw:li9p2cq2pghr",
    "23.95.150.145:6114:bacgvrmw:li9p2cq2pghr",
    "198.23.239.134:6540:bacgvrmw:li9p2cq2pghr",
    "45.38.107.97:6014:bacgvrmw:li9p2cq2pghr",
    "107.172.163.27:6543:bacgvrmw:li9p2cq2pghr",
    "198.105.121.200:6462:bacgvrmw:li9p2cq2pghr",
    "216.10.27.159:6837:bacgvrmw:li9p2cq2pghr",
    "142.111.67.146:5611:bacgvrmw:li9p2cq2pghr",
    "191.96.254.138:6185:bacgvrmw:li9p2cq2pghr",
    "31.58.9.4:6077:bacgvrmw:li9p2cq2pghr"
];

// 2. Load Accounts from Secrets
const allAccounts = JSON.parse(process.env.ACCOUNTS_JSON || "[]");
const NODE_INDEX = parseInt(process.env.NODE_INDEX || "0");
const TOTAL_NODES = parseInt(process.env.TOTAL_NODES || "4");

if (allAccounts.length === 0) {
    console.error("❌ ACCOUNTS_JSON missing! Please check GitHub Secrets.");
    process.exit(1);
}

const currentCookies = allAccounts[NODE_INDEX % allAccounts.length];

// Extract Alias and actual cookies
const accountAlias = currentCookies.find(c => c.name === 'account_alias')?.value || `Unknown_ID_${currentCookies.find(c => c.name === 'ds_user_id')?.value}`;
const actualCookies = currentCookies.filter(c => c.name !== 'account_alias');
const cookieString = actualCookies.map(c => `${c.name}=${c.value}`).join('; ');
const csrfToken = actualCookies.find(c => c.name === 'csrftoken')?.value || '';

// 3. Setup Proxy
function getProxyConfig(proxyString) {
    const [host, port, username, password] = proxyString.split(':');
    return { protocol: 'http', host, port: parseInt(port), auth: { username, password } };
}

const selectedProxyString = proxyList[NODE_INDEX % proxyList.length];
const proxyConfig = getProxyConfig(selectedProxyString);

console.log(`\n======================================================`);
console.log(`🟢 [POD-${NODE_INDEX} BOOT]`);
console.log(`👤 Assigned Account: ${accountAlias}`);
console.log(`🌐 Assigned Proxy IP: ${proxyConfig.host}`);
console.log(`======================================================\n`);

// 4. Axios Setup
const apiClient = axios.create({
    proxy: proxyConfig,
    headers: {
        'authority': 'www.instagram.com',
        'accept': '*/*',
        'cookie': cookieString,
        'x-csrftoken': csrfToken,
        'x-ig-app-id': '936619743392459',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const extractShortcode = (url) => { const match = url.match(/(?:p|reel)\/([^\/?#&]+)/); return match ? match[1] : url.trim(); };

async function fetchComments(shortcode, cursor = null) {
    try {
        let variables = JSON.stringify({ shortcode: shortcode, first: 50, after: cursor });
        let url = `https://www.instagram.com/graphql/query/?query_hash=bc3296d1ce80a24b1b6e40b1e72903f5&variables=${encodeURIComponent(variables)}`;
        const res = await apiClient.get(url);
        return res.data?.data?.shortcode_media?.edge_media_to_parent_comment || null;
    } catch (e) { 
        return null; 
    }
}

async function scrapeFullPost(shortcode, nodeIdx, workerId, linkIdx, totalLinks) {
    let allComments = [];
    let hasNextPage = true;
    let cursor = null;
    let targetComments = 0;
    let retryCount = 0;
    const MAX_RETRIES = 10;
    const LIMIT = 10000;

    console.log(`🚀 [POD-${nodeIdx} | Acc: ${accountAlias}] Starting Link ${linkIdx}/${totalLinks} | Post: ${shortcode}`);

    while (hasNextPage && allComments.length < LIMIT && retryCount < MAX_RETRIES) {
        const data = await fetchComments(shortcode, cursor);
        
        if (!data || !data.edges || data.edges.length === 0) {
            retryCount++;
            // 🚨 NAYA FEATURE: Block Alert
            console.log(`🛑 [RATE LIMIT WARNING - POD ${nodeIdx}] Account '${accountAlias}' is getting blocked/0-comments on ${shortcode}. Retry ${retryCount}/${MAX_RETRIES}`);
            await wait(randomDelay(8000, 12000));
            continue; 
        }

        targetComments = data.count || targetComments;
        
        const mapped = data.edges.map(e => ({
            id: e.node.id,
            text: e.node.text,
            created_at: e.node.created_at,
            owner: {
                id: e.node.owner.id,
                username: e.node.owner.username,
                profile_pic_url: e.node.owner.profile_pic_url,
                is_verified: e.node.owner.is_verified
            },
            viewer_has_liked: e.node.viewer_has_liked,
            comment_like_count: e.node.edge_liked_by?.count || 0
        }));
        
        allComments.push(...mapped);

        console.log(`📊 [POD-${nodeIdx} | Acc: ${accountAlias}] Progress: ${linkIdx}/${totalLinks} | Post: ${shortcode} | Count: ${allComments.length}/${targetComments}`);

        hasNextPage = data.page_info.has_next_page;
        cursor = data.page_info.end_cursor;
        
        if (allComments.length >= targetComments) break;
        await wait(randomDelay(3500, 5500)); 
    }

    return { 
        shortcode: shortcode, 
        total_comments_on_post: targetComments, 
        fetched_at: new Date().toISOString(),
        comments: allComments
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
            await wait(randomDelay(6000, 9000));
        }
    }
    
    // Safety: 1 Worker per Pod to prevent aggressive blocking
    await Promise.all([worker(1)]);
}

(async () => {
    const BATCH_FOLDER = process.env.BATCH_FOLDER || "Default";
    try {
        const fileContent = fs.readFileSync('/app/links.txt', 'utf-8');
        const uniqueLinks = [...new Set(fileContent.split(/[\n\s,]+/).filter(Boolean).map(extractShortcode))];
        const myLinks = uniqueLinks.filter((_, i) => i % TOTAL_NODES === NODE_INDEX);
        await runEngine(myLinks, NODE_INDEX, BATCH_FOLDER);
    } catch (e) { console.error(e); }
})();
