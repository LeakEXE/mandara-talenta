const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/database');
const dashboardRouter = require('../routes/dashboard');
const searchRouter = require('../routes/search');

const activeStudentCondition = '(is_graduated = 0 OR is_graduated IS NULL)';

function getRouteHandler(router, path) {
    const layer = router.stack.find((item) => item.route && item.route.path === path);
    assert.ok(layer, `Route ${path} should exist`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test('dashboard active-student metrics exclude graduates and retain null graduation flags', async () => {
    const originalQuery = db.query;
    const queries = [];
    db.query = async (sql) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return [[{}]];
    };

    try {
        const response = createResponse();
        await getRouteHandler(dashboardRouter, '/stats')({}, response);

        assert.equal(response.statusCode, 200);
        const userQueries = queries.filter((sql) => sql.includes('FROM users'));
        const filteredMetrics = userQueries.filter((sql) =>
            sql.includes(activeStudentCondition)
        );

        assert.equal(filteredMetrics.length, 6);
        assert.ok(filteredMetrics.some((sql) => sql.includes('COUNT(*) as count')));
        assert.ok(filteredMetrics.some((sql) => sql.includes('GROUP BY grha')));
        assert.ok(filteredMetrics.some((sql) => sql.includes('GROUP BY kelas')));
        assert.ok(filteredMetrics.some((sql) => sql.includes('AVG(ipt_total)')));
        assert.ok(filteredMetrics.some((sql) => sql.includes('ORDER BY ipt_total DESC')));
        assert.ok(filteredMetrics.some((sql) => sql.includes('GROUP BY desil')));
    } finally {
        db.query = originalQuery;
    }
});

test('student category leaderboard excludes graduates while allowing null graduation flags', async () => {
    const originalQuery = db.query;
    let leaderboardQuery = '';
    db.query = async (sql) => {
        leaderboardQuery = sql.replace(/\s+/g, ' ').trim();
        return [[{ id: 1, total_point: '10' }]];
    };

    try {
        const response = createResponse();
        await getRouteHandler(
            searchRouter,
            '/leaderboard/category/:category'
        )({ params: { category: 'prestasi' } }, response);

        assert.equal(response.statusCode, 200);
        assert.match(leaderboardQuery, /WHERE u\.role = 'siswa' AND \(u\.is_graduated = 0 OR u\.is_graduated IS NULL\)/);
        assert.equal(response.body[0].total_point, 10);
    } finally {
        db.query = originalQuery;
    }
});
