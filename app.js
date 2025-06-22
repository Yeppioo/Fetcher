const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

(async () => {
    try {
        const response = await axios.get(config.linkPage);
        const html = response.data;
        const $ = cheerio.load(html);
        // 解析分组和每组下的友链
        const result = [];
        // 遍历所有分组标题（h2）
        $('#article-container .flink > h2').each((i, el) => {
            const groupName = $(el).text().replace(/\s+/g, '').replace(/\(.*\)/, '').trim();
            if (groupName === '我的信息') return; // 跳过'我的信息'分组
            // 找到下一个.flink-list，获取其中所有友链
            const groupLinks = [];
            let flinkList = $(el).next('.flink-list');
            if (flinkList.length) {
                flinkList.find('.flink-list-item').each((j, item) => {
                    const a = $(item).find('a');
                    const name = a.find('.flink-item-name').text().trim();
                    const url = a.attr('href');
                    const avatar = a.find('img').attr('src');
                    groupLinks.push({ name, url, avatar });
                });
            }
            result.push({ group: groupName, links: groupLinks });
        });
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('获取或解析页面失败:', error);
    }
})();
