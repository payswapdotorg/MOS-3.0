/**
 * mos-integrations 完整公共 API。
 */
export * from "./contract/hubspot-descriptor.js";
export * from "./contract/read-adapter.js";
export * from "./connector/hubspot-connector-declaration.js";
export * from "./domain/read-summary.js";
export * from "./application/connection-store.js";
export * from "./application/read-adapter.js";
export { mosIntegrationsModule } from "./module.js";

/**
 * 底物端口窄转发：module registry 规定 mos-capabilities 只依赖
 * mos-integrations（不直接依赖 zcode-mos-adapters），所以把它的消费方
 * 需要的接缝（scope 覆盖纯函数、TimePort + 系统时钟实现）从这里转发。
 */
export { missingScopes, SystemTimePort } from "@mos/adapters";
export type { TimePort } from "@mos/adapters";

