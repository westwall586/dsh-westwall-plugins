// 数据契约类型：T01 起步（日期/env 基础），随任务推进补全。
// 内部引擎结构镜像参考实现 plan()/submit() 的 JSON 形态（snake_case），
// 窗口视图与素材等插件自有消费契约（camelCase）在服务边界映射。
/** HTTP 4xx/5xx 的归一错误——客户端层据此区分「确定性失败」与网络抖动。 */
export class HttpError extends Error {
    status;
    constructor(status, reason) {
        super(`HTTP ${status}: ${reason}`);
        this.name = 'HttpError';
        this.status = status;
    }
}
//# sourceMappingURL=types.js.map