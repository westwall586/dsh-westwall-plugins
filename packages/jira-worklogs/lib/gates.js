// 写入门禁的纯逻辑：同日互斥（Host 提交路径消费）。
// 确认语义已迁移为 Host 内部给定（UI「提交」按钮＝显式确认，D6），
// 报告映射收敛在 service.ts submitReportFrom（单一真相源）——requireConfirm 与
// mapSubmitReport 随模型工具路径移除（2026-09-24 Wave，审计 M4）。
/** 同一目标日的写入互斥：进行中再入直接拒绝（进程内，锁粒度＝日期）。 */
export class DayMutex {
    held = new Set();
    /** 命中互斥抛错；否则返回释放函数。 */
    acquire(date) {
        if (this.held.has(date)) {
            throw new Error(`目标日 ${date} 已有写入进行中，请等待其完成后再提交`);
        }
        this.held.add(date);
        return () => this.held.delete(date);
    }
}
/** 批量获取：任一日期失败即回滚已获取的，避免部分持锁泄漏。 */
export function acquireAll(mutex, dates) {
    const releases = [];
    try {
        for (const date of dates)
            releases.push(mutex.acquire(date));
    }
    catch (error) {
        for (const release of releases)
            release();
        throw error;
    }
    return () => {
        for (const release of releases)
            release();
    };
}
//# sourceMappingURL=gates.js.map