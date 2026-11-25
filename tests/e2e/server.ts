/**
 * e2e 与 globalSetup 共用的服务器地址。
 * 单独放一个文件：config 与 setup 都不该为了拿一个端口号去 import 对方的模块。
 *
 * `BASE_URL` 带上真实的部署基路径（默认 `/Sticky/`）：本地跑的就是线上那种
 * "子路径部署"形态，base 写错会在这里当场 404，而不是等发布后白屏（决策 72）。
 * 因此测试里的 `page.goto('./')` 才会落到应用入口 —— `'/'` 是**站点根**，不是应用根。
 */
import { DEPLOY_BASE } from '../../deploy-base';

export const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${PORT}${DEPLOY_BASE}`;
