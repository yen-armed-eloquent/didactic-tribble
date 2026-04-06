const fs = require('fs');
const axios = require('axios');

// 4 Accounts Setup (Ek Pod ke liye ek account)
const allAccounts = [
    [ // Account 0
        { name: "sessionid", value: "34851865843%3AQ2qBU5qbunfnbl%3A16%3AAYg7GpcU_BNeZFg2GdEfZMkov_A7HU5lodT0ndYthg" },
        { name: "ds_user_id", value: "34851865843" },
        { name: "csrftoken", value: "CoBFT1SDnGcdRS0i2lov3sCyoxWcKN5g" },
        { name: "rur", value: "\"CCO\\05434851865843\\0541806695909:01fefc3aaf8954a13afccb53bc6bc14d2076a33013460c5070a1a3928e1352a7dcf1fd86\"" }
    ],
    [ // Account 1
        { name: "sessionid", value: "38788505427%3AoYuwfFVuzDcnq0%3A28%3AAYgrMlQDJouTAum_n9uUXDkOpvkOhxfPHMElK0QdOg" },
        { name: "ds_user_id", value: "38788505427" },
        { name: "csrftoken", value: "wXFdA8KB8H8S8yX3d6XDeeMMacoaweMN" },
        { name: "rur", value: "\"SNB\\05438788505427\\0541806688123:01fee2be22358400075b6c0079c7453c21b0808a17aa260de1345d5926fc89712eded827\"" }
    ],
    [ // Account 2
        { name: "sessionid", value: "39290986204%3AdGwG66mloD5QB1%3A11%3AAYiYyj3Vuy7bXWs5L5GwYi8R_9x-Z_1j5_5haKyfog" },
        { name: "ds_user_id", value: "39290986204" },
        { name: "csrftoken", value: "KnG69hXyV3zk6EASVTqf6N511Dlj8Fth" },
        { name: "rur", value: "\"NCG\\05439290986204\\0541806685218:01fe43f4cf9404375fbad6c5ca4cff1aa203377a9867fd38e62aa13d2c68459fe113f294\"" }
    ],
    [ // Account 3
        { name: "sessionid", value: "37280264568%3AEo23n7imUAUoLf%3A14%3AAYiEPMa1_46z6X36VhKV7Eq7nbFnxVdj-vdXK7vdEw" },
        { name: "ds_user_id", value: "37280264568" },
        { name: "csrftoken", value: "Rrz6Ods47cV6L9IaexonDpJy5asTjs64" },
        { name: "rur", value: "\"LDC\\05437280264568\\0541806456819:01fe5bdd4604a50ef8090f3b159ece39e5263b5a0a20c668af500fe9b44e7286af16dbc5\"" }
    ]
];

const NODE_INDEX = parseInt(process.env.NODE_INDEX || "0");
const TOTAL_NODES = parseInt(process.env.TOTAL_NODES || "4");
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
        if (res.data && res.data.data && res.data.data.shortcode_media) {
            return res.data.data.shortcode_media.edge_media_to_parent_comment;
        }
        return null;
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

    console.log(`\n🚀 [POD-${nodeIdx} | W-${workerId}] Started Link ${linkIdx}/${totalLinks} | Post: ${shortcode}`);

    while (hasNextPage && allComments.length < LIMIT && retryCount < MAX_RETRIES) {
        const data = await fetchComments(shortcode, cursor);
        
        if (!data || !data.edges || data.edges.length === 0) {
            retryCount++;
            console.log(`⚠️ [POD-${nodeIdx} | W-${workerId}] 0 data received for ${shortcode}. Retry: ${retryCount}/${MAX_RETRIES}`);
            await wait(7000); // Wait longer if blocked
            continue; 
        }

        targetComments = data.count || targetComments;
        const mapped = data.edges.map(e => ({
            id: e.node.id,
            text: e.node.text,
            owner_username: e.node.owner.username
        }));
        allComments.push(...mapped);

        console.log(`📊 [POD-${nodeIdx} | W-${workerId}] Post: ${shortcode} | Extracted: ${allComments.length}/${targetComments} | Goal: ${LIMIT} | Retries: ${retryCount}/10`);

        hasNextPage = data.page_info.has_next_page;
        cursor = data.page_info.end_cursor;
        
        if (allComments.length >= targetComments) break;
        await wait(3000); // Safe delay between pages
    }

    console.log(`✅ [POD-${nodeIdx} | W-${workerId}] Finished: ${shortcode} | Total Saved: ${allComments.length}`);
    return { shortcode, commentsRawData: allComments };
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
            await wait(5000); // Delay before jumping to next post
        }
    }
    await Promise.all([worker(1), worker(2), worker(3)]); // 3 Workers per Pod
}

(async () => {
    const BATCH_FOLDER = process.env.BATCH_FOLDER || "Default";
    try {
        const fileContent = fs.readFileSync('/app/links.txt', 'utf-8');
        const uniqueLinks = [...new Set(fileContent.split(/[\n\s,]+/).filter(Boolean).map(extractShortcode))];
        const myLinks = uniqueLinks.filter((_, i) => i % TOTAL_NODES === NODE_INDEX);
        console.log(`👤 Pod ${NODE_INDEX} Initialized with Account Index ${NODE_INDEX % allAccounts.length}. Assigned ${myLinks.length} links.`);
        await runEngine(myLinks, NODE_INDEX, BATCH_FOLDER);
    } catch (e) {
        console.error("Critical Error in Pod:", e);
    }
})();
