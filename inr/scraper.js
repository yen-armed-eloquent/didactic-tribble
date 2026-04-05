const fs = require('fs');
const axios = require('axios');

const rawCookiesJson = [
    { "name": "ps_n", "value": "1" },
    { "name": "datr", "value": "wvnKaXJYRz4aXiVe6VbxhC3U" },
    { "name": "ds_user_id", "value": "37280264568" },
    { "name": "csrftoken", "value": "Rrz6Ods47cV6L9IaexonDpJy5asTjs64" },
    { "name": "ig_did", "value": "8A708E74-81C2-4848-AAC4-C7CA8B170615" },
    { "name": "ps_l", "value": "1" },
    { "name": "wd", "value": "1517x674" },
    { "name": "mid", "value": "acr5wgALAAHBhIyl5c18lss1W-Ij" },
    { "name": "sessionid", "value": "37280264568%3AEo23n7imUAUoLf%3A14%3AAYhgAl_jhQXp8_bqszU-ToIW77L7cDVEjHxh4LaA9Q" },
    { "name": "dpr", "value": "0.8999999761581421" },
    { "name": "rur", "value": "\"RVA\\05437280264568\\0541806967301:01fea4a4aa50324069d1a536b41d712807ec6b292a79e2182734b4f0c2673ad563b15388\"" }
];

const cookieString = rawCookiesJson.map(c => `${c.name}=${c.value}`).join('; ');
const csrfToken = rawCookiesJson.find(c => c.name === 'csrftoken')?.value || '';

const STEALTH_HEADERS = {
    'x-ig-app-id': '936619743392459',
    'x-csrftoken': csrfToken,
    'x-requested-with': 'XMLHttpRequest',
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://www.instagram.com/'
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function igFetch(url, retries = 5, backoff = 10000) {
    try {
        const response = await axios.get(url, { headers: STEALTH_HEADERS, timeout: 20000 });
        return response.data;
    } catch (error) {
        if (retries > 0) {
            await wait(backoff);
            return await igFetch(url, retries - 1, backoff * 1.5);
        }
        return null;
    }
}

async function fetchAllComments(mediaId, expectedCount, podIdx, workerId, postNum, totalPosts, shortcode) {
    let allComments = [];
    let endCursor = '';
    let hasNext = true;
    let page = 1;
    let forceRetryCount = 0;
    const MAX_FORCE_RETRIES = 10;
    const targetCount = Math.min(expectedCount, 10000);

    console.log(`🎯 [Pod-${podIdx}] Post ${postNum}/${totalPosts}: [${shortcode}] Target: ${targetCount}`);

    while (hasNext && allComments.length < 10000) {
        const vars = JSON.stringify({ shortcode, first: 50, after: endCursor || null });
        const url = `https://www.instagram.com/graphql/query/?query_hash=97b41c52301f77ce508f55e66d17620e&variables=${encodeURIComponent(vars)}`;
        const data = await igFetch(url);

        if (!data || !data.data) break;
        const commentsEdge = data.data?.shortcode_media?.edge_media_to_parent_comment;
        if (!commentsEdge) break;

        const newNodes = commentsEdge.edges.map(e => e.node);
        const newUnique = newNodes.filter(nc => !allComments.some(ac => ac.id === nc.id));
        allComments.push(...newUnique);

        console.log(`   ↳ 📜 [Pod-${podIdx} | W-${workerId}] Page ${page}: Total ${allComments.length}/${targetCount}`);

        if (commentsEdge.page_info.has_next_page) {
            endCursor = commentsEdge.page_info.end_cursor;
            page++;
            forceRetryCount = 0;
            await wait(2000);
        } else {
            if (allComments.length < targetCount && forceRetryCount < MAX_FORCE_RETRIES) {
                forceRetryCount++;
                console.log(`   ↳ ⚠️ [Pod-${podIdx}] Retrying (${forceRetryCount}/10)...`);
                await wait(5000);
            } else {
                hasNext = false;
            }
        }
    }
    return allComments;
}

async function scrapeFullPost(shortcode, podIdx, workerId, postNum, totalPosts) {
    const docId = '8845758582119845';
    const vars = JSON.stringify({ shortcode, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null });
    const url = `https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(vars)}`;

    const response = await igFetch(url);
    if (!response || !response.data) return null;
    const postData = response.data.xdt_shortcode_v2 || response.data.xdt_shortcode_media;
    if (!postData) return null;

    const expected = postData.edge_media_to_parent_comment?.count || 0;
    const comments = await fetchAllComments(postData.id, expected, podIdx, workerId, postNum, totalPosts, shortcode);

    return { timestamp: new Date().toISOString(), shortcode, postRawData: postData, commentsRawData: comments };
}

function extractShortcode(url) {
    const match = url.trim().match(/(?:p|reels?|tv)\/([A-Za-z0-9_\-]+)/);
    return match ? match[1] : url.trim();
}

async function runEngine(links, nodeIdx, batchFolder) {
    let currentIndex = 0;
    const TARGET_DIR = `/data/output/${batchFolder}`;
    if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });
    const DATASET_FILE = `${TARGET_DIR}/Dataset_Pod_${nodeIdx}.json`;
    fs.writeFileSync(DATASET_FILE, JSON.stringify([]));

    async function worker(workerId) {
        while (currentIndex < links.length) {
            const sc = links[currentIndex++];
            const fullData = await scrapeFullPost(sc, nodeIdx, workerId, currentIndex, links.length);
            if (fullData) {
                const currentData = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf-8'));
                currentData.push(fullData);
                fs.writeFileSync(DATASET_FILE, JSON.stringify(currentData, null, 2));
            }
            await wait(4000);
        }
    }
    await Promise.all([worker(1), worker(2), worker(3)]);
}

(async () => {
    const NODE_INDEX = process.env.NODE_INDEX || "0";
    const TOTAL_NODES = process.env.TOTAL_NODES || "1";
    const BATCH_FOLDER = process.env.BATCH_FOLDER || "Default";
    try {
        const fileContent = fs.readFileSync('/app/links.txt', 'utf-8');
        const uniqueLinks = [...new Set(fileContent.split(/[\n\s,]+/).filter(Boolean).map(extractShortcode))];
        const myLinks = uniqueLinks.filter((_, i) => i % parseInt(TOTAL_NODES) === parseInt(NODE_INDEX));
        await runEngine(myLinks, NODE_INDEX, BATCH_FOLDER);
        console.log(`🏁 [POD-${NODE_INDEX}] MUKAMMAL HO GAYA! Standing By...`);
        await wait(86400000);
    } catch (err) {
        console.error("❌ Error:", err.message);
        await wait(86400000);
    }
})();
