const db = require('../config/database');

let statusColumn = null;

async function getApprovalStatusColumn() {
    if (statusColumn) {
        return statusColumn;
    }

    // Postgres equivalent of SHOW COLUMNS ... LIKE (schema is fixed, but keep the probe PG-safe)
    const [columns] = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'prestasi_approvals' AND column_name = 'superadmin_status'`
    );
    statusColumn = columns.length > 0 ? 'superadmin_status' : 'status';
    return statusColumn;
}

function getRowApprovalStatus(row) {
    return row.superadmin_status ?? row.status;
}

async function fetchPendingApprovals(table, alias) {
    const col = await getApprovalStatusColumn();
    // "Diajukan Oleh" = the account that actually submitted (submitted_by),
    // NOT the target student (user_id). Fall back to the target student for
    // legacy rows where submitted_by is NULL. submitted_by_* extras are
    // additive metadata for the frontend; user_name keeps its shape.
    const [rows] = await db.query(`
        SELECT ${alias}.*,
               COALESCE(submitter.nama, target_user.nama) as user_name,
               submitter.nama as submitted_by_name,
               submitter.role as submitted_by_role
        FROM ${table} ${alias}
        JOIN users target_user ON ${alias}.user_id = target_user.id
        LEFT JOIN users submitter ON ${alias}.submitted_by = submitter.id
        WHERE ${alias}.${col} = 'pending'
    `);
    return rows;
}

async function approveSubmission(table, id, notes, executor = null) {
    const q = executor || db.query;
    const col = await getApprovalStatusColumn();
    const noteText = notes || 'Disetujui oleh SuperAdmin';

    if (col === 'superadmin_status') {
        const [marked] = await q(
            `UPDATE ${table}
             SET superadmin_status = 'approved',
                 superadmin_approved_at = NOW(),
                 superadmin_notes = ?
             WHERE id = ? AND superadmin_status = 'pending'`,
            [noteText, id]
        );
        return marked.affectedRows;
    }

    const [marked] = await q(
        `UPDATE ${table}
         SET status = 'approved',
             approved_at = NOW(),
             notes = ?
         WHERE id = ? AND status = 'pending'`,
        [noteText, id]
    );
    return marked.affectedRows;
}

async function rejectSubmission(table, id, notes, executor = null) {
    const q = executor || db.query;
    const col = await getApprovalStatusColumn();
    const noteText = notes || 'Ditolak oleh SuperAdmin';

    if (col === 'superadmin_status') {
        const [marked] = await q(
            `UPDATE ${table}
             SET superadmin_status = 'rejected',
                 superadmin_notes = ?
             WHERE id = ? AND superadmin_status = 'pending'`,
            [noteText, id]
        );
        return marked.affectedRows;
    }

    const [marked] = await q(
        `UPDATE ${table}
         SET status = 'rejected',
             notes = ?
         WHERE id = ? AND status = 'pending'`,
        [noteText, id]
    );
    return marked.affectedRows;
}

module.exports = {
    getApprovalStatusColumn,
    getRowApprovalStatus,
    fetchPendingApprovals,
    approveSubmission,
    rejectSubmission
};
