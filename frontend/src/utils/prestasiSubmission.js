export function canEditGroupSubmission(members, currentUserId) {
    if (!Array.isArray(members) || members.length === 0 || currentUserId == null) {
        return false;
    }

    return members.every((member) => (
        member.status === 'pending'
        && member.submitted_by != null
        && Number(member.submitted_by) === Number(currentUserId)
    ));
}
