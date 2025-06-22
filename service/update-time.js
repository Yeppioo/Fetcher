const fs = require('fs');
const path = require('path');

function updateTime() {
    const updateTime = new Date().toISOString();
    fs.writeFileSync('./api/static/data/time.txt', updateTime);
}

module.exports = updateTime;