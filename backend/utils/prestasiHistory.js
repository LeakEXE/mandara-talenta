function buildUserPrestasiHistoryQuery(userId) {
    return {
        sql: `
            SELECT *,
                   superadmin_status as status,
                   'prestasi' as type
            FROM prestasi_approvals
            WHERE user_id = ? OR submitted_by = ? OR (
                grup_lomba IS NOT NULL
                AND grup_lomba IN (
                    SELECT grup_lomba
                    FROM prestasi_approvals
                    WHERE (user_id = ? OR submitted_by = ?)
                      AND grup_lomba IS NOT NULL
                )
            )
            ORDER BY created_at DESC
        `,
        params: [userId, userId, userId, userId]
    };
}

module.exports = { buildUserPrestasiHistoryQuery };
