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
function printProgress(current, total, url) {
    const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
    const barLength = 40;
    const filledLength = Math.floor(barLength * percent / 100);
    const bar = `\x1b[32m${'='.repeat(filledLength)}${filledLength < barLength ? '>' : ''}${' '.repeat(barLength - filledLength - 1)}\x1b[0m`;
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`[${bar}] ${current}/${total} (${percent}%)  ${cyan}${url}${reset}`);
    if (current === total) process.stdout.write('\n');
}

// 并发处理友链检测，每拼接一个页面都实时刷新进度条
async function checkLink(link, config, progress) {
    let checked = false;
    let isOld = false;
    let error = false;
    let checkedUrl = '';
    for (const page of config.page) {
        let pageUrl = link.url;
        if (!pageUrl.endsWith('/')) pageUrl += '/';
        pageUrl += page;
        checkedUrl = pageUrl;
        progress(pageUrl);
        try {
            const res = await axios.get(pageUrl, { timeout: 10000 });
            const pageHtml = res.data;
            const { isBack, isOld: isOldLink } = checkBackLink(pageHtml, config.backLink, config.oldLink);
            if (isBack) {
                return { type: 'success', link: { ...link, page: pageUrl }, url: checkedUrl };
            } else if (isOldLink) {
                isOld = true;
            }
        } catch (e) {
            error = true;
            continue;
        }
    }
    if (isOld) {
        return { type: 'old', link, url: checkedUrl };
    } else if (error) {
        return { type: 'error', link, url: checkedUrl };
    } else {
        return { type: 'fail', link, url: checkedUrl };
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
            fail: [],    // 未反链
            error: []    // 访问失败
        };

        // 统计总拼接页面数
        const total = links.length * config.page.length;
        let current = 0;
        let lastUrl = '';
        // 实时并发控制
        const concurrency = 20;
        let index = 0;
        // 任务队列
        const queue = [];
        function next() {
            if (index >= links.length) return null;
            const link = links[index++];
            return link;
        }
        async function worker() {
            while (true) {
                const link = next();
                if (!link) break;
                const r = await checkLink(link, config, (url) => {
                    current++;
                    lastUrl = url;
                    printProgress(current, total, lastUrl);
                });
                result[r.type].push(r.link);
            }
        }
        // 启动并发worker
        printProgress(0, total, ''); // 一开始就输出进度条
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
