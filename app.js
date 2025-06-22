const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

// 检查页面内容是否包含反链
function checkBackLink(html, backLinks, oldLinks) {
    let isBack = false;
    let isOld = false;
    for (const back of backLinks) {
        if (html.includes(back)) {
            isBack = true;
            break;
        }
    }
    if (!isBack) {
        for (const old of oldLinks) {
            if (html.includes(old)) {
                isOld = true;
                break;
            }
        }
    }
    return { isBack, isOld };
}

// pip风格进度条输出（单行，横线，使用clearLine+cursorTo）
function printProgress(current, total, url, finishedLinks, linkTotal) {
    const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
    const barLength = 40;
    const filledLength = Math.floor(barLength * percent / 100);
    let bar = '';
    if (filledLength >= barLength) {
        bar = `\x1b[32m${'='.repeat(barLength)}\x1b[0m`;
    } else {
        bar = `\x1b[32m${'='.repeat(filledLength)}>${' '.repeat(barLength - filledLength - 1)}\x1b[0m`;
    }
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`[${bar}] ${current}/${total} (${percent}%)  [${finishedLinks}/${linkTotal}]  ${cyan}${url}${reset}`);
    if (current === total) process.stdout.write('\n');
}

// 并发处理友链检测，每拼接一个页面都实时刷新进度条
async function checkLink(link, config, progress, finishedLinks, linkTotal) {
    let checkedUrl = '';
    let hasSuccess = false; // 是否有页面访问成功
    const pageCount = config.page.length;
    let i = 0;
    for (; i < pageCount; i++) {
        let page = config.page[i];
        let pageUrl = link.url;
        if (!pageUrl.endsWith('/')) pageUrl += '/';
        pageUrl += page;
        checkedUrl = pageUrl;
        progress(pageUrl, finishedLinks, linkTotal);
        try {
            const res = await axios.get(pageUrl, { timeout: 10000, validateStatus: null });
            if (res.status >= 200 && res.status < 400) {
                hasSuccess = true;
                const pageHtml = res.data;
                const { isBack, isOld: isOldLink } = checkBackLink(pageHtml, config.backLink, config.oldLink);
                if (isBack) {
                    // 检测到反链，补齐剩余进度
                    for (let j = i + 1; j < pageCount; j++) {
                        progress('', finishedLinks, linkTotal);
                    }
                    return { type: 'success', link: { ...link, page: pageUrl }, url: checkedUrl };
                } else if (isOldLink) {
                    for (let j = i + 1; j < pageCount; j++) {
                        progress('', finishedLinks, linkTotal);
                    }
                    return { type: 'old', link, url: checkedUrl };
                }
            }
        } catch (e) {
            // 网络错误等，继续尝试下一个页面
            continue;
        }
    }
    // 补齐未提前return时的进度（正常遍历完）
    for (let j = i; j < pageCount; j++) {
        progress('', finishedLinks, linkTotal);
    }
    // 如果所有页面都访问失败（无2xx/3xx），归为fail，否则notFound
    if (!hasSuccess) {
        return { type: 'fail', link, url: checkedUrl };
    } else {
        return { type: 'notFound', link, url: checkedUrl };
    }
}

(async () => {
    try {
        const response = await axios.get(config.linkPage);
        const html = response.data;
        const $ = cheerio.load(html);
        // 解析分组和每组下的友链
        const links = [];
        $('#article-container .flink > h2').each((i, el) => {
            const groupName = $(el).text().replace(/\s+/g, '').replace(/\(.*\)/, '').trim();
            if (groupName === '我的信息') return;
            let flinkList = $(el).next('.flink-list');
            if (flinkList.length) {
                flinkList.find('.flink-list-item').each((j, item) => {
                    const a = $(item).find('a');
                    const name = a.find('.flink-item-name').text().trim();
                    const url = a.attr('href');
                    const avatar = a.find('img').attr('src');
                    links.push({ name, url, avatar });
                });
            }
        });

        // 结果分类
        const result = {
            success: [], // 正确反链
            old: [],     // 旧版反链
            fail: [],    // 全部访问失败
            notFound: [] // 有页面访问成功但没有反链
        };

        // 统计总拼接页面数
        const total = links.length * config.page.length;
        let current = 0;
        let lastUrl = '';
        // 实时并发控制
        const concurrency = 20;
        let index = 0;
        const linkTotal = links.length;
        let finishedLinks = 0;
        // 任务队列
        function next() {
            if (index >= links.length) return null;
            const link = links[index++];
            return { link, linkIndex: index, linkTotal };
        }
        async function worker() {
            while (true) {
                const nextLink = next();
                if (!nextLink) break;
                const { link, linkIndex, linkTotal } = nextLink;
                const r = await checkLink(link, config, (url, finished, totalLinks) => {
                    current++;
                    lastUrl = url;
                    printProgress(current, total, lastUrl, finishedLinks, linkTotal);
                }, finishedLinks, linkTotal);
                result[r.type].push(r.link);
                finishedLinks++;
            }
        }
        // 启动并发worker
        printProgress(0, total, '', 0, linkTotal); // 一开始就输出进度条
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        process.stdout.write('\n');
        console.log('检测完成，结果如下：');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('获取或解析页面失败:', error);
    }
})();
