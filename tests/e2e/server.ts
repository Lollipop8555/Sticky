/**
 * e2e 与 globalSetup 共用的服务器地址。
 * 单独放一个文件：config 与 setup 都不该为了拿一个端口号去 import 对方的模块。
 */
export const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
