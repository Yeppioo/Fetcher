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

        // 检查每个友链
        for (const link of links) {
            let checked = false;
            let isOld = false;
            let error = false;
            for (const page of config.page) {
                let pageUrl = link.url;
                if (!pageUrl.endsWith('/')) pageUrl += '/';
                pageUrl += page;
                try {
                    const res = await axios.get(pageUrl, { timeout: 10000 });
                    const pageHtml = res.data;
                    const { isBack, isOld: isOldLink } = checkBackLink(pageHtml, config.backLink, config.oldLink);
                    if (isBack) {
                        result.success.push({ ...link, page: pageUrl });
                        checked = true;
                        break;
                    } else if (isOldLink) {
                        isOld = true;
                    }
                } catch (e) {
                    error = true;
                    continue;
                }
            }
            if (!checked) {
                if (isOld) {
                    result.old.push(link);
                } else if (error) {
                    result.error.push(link);
                } else {
                    result.fail.push(link);
                }
            }
        }
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('获取或解析页面失败:', error);
    }
})();
