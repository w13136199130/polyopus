#!/usr/bin/env node
/**
 * 重新生成 prototype/shots 下的评审截图。
 *
 *   node prototype/make-shots.mjs            # 全部
 *   node prototype/make-shots.mjs chat usage # 只重拍指定名字
 *
 * 浏览器复用 web/ 下已安装的 @playwright/test，默认走系统 Edge（channel=msedge），
 * 与 web/playwright.config.ts 保持一致，不需要额外下载 Chromium。
 * 桌面稿 1600×1000，窄屏稿见 MANIFEST 内 width/height，移动稿 500×900。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'web', 'node_modules', 'noop.js'));
const { chromium } = require('@playwright/test');

const SHOTS = path.join(here, 'shots');
const BASE = 'file:///' + here.replace(/\\/g, '/') + '/index.html';

/** [文件名, query+hash, viewport?] */
const MANIFEST = [
  ['chat', '#/chat'],
  ['chat-s2', '?session=s2#/chat'],
  ['chat-ask', '?session=s3#/chat'],
  ['chat-plan', '?session=s4#/chat'],
  ['chat-dock', '?dock=1#/chat'],
  ['chat-edit', '?edit=1#/chat'],
  ['chat-error', '?state=error#/chat'],
  ['chat-nomodel', '?state=nomodel#/chat'],
  ['welcome', '?welcome=1#/chat'],
  ['dark', '?theme=dark#/chat'],
  ['rail', '#/agents'],
  ['rail-collapsed', '?rail=1#/agents'],
  ['user-menu', '?menu=user#/chat'],
  ['sidebar', '#/chat'],
  ['chat-1280', '#/chat', { width: 1280, height: 900 }],
  ['chat-1366', '#/chat', { width: 1366, height: 900 }],
  ['tasks', '#/tasks'],
  ['ticket', '#/ticket/tk_412'],
  ['inbox', '#/inbox'],
  ['agents', '#/agents'],
  ['agent-drawer', '?agent=ag_1#/agents'],
  ['automation', '#/automation'],
  ['knowledge', '#/knowledge'],
  ['knowledge-cards', '?kbview=card#/knowledge'],
  ['knowledge-retrieval', '?kbtab=retrieval#/knowledge'],
  ['knowledge-settings', '?kbsettings=1#/knowledge'],
  ['knowledge-edit', '?kbedit=1#/knowledge'],
  ['connections', '#/connections'],
  ['connections-empty', '?state=noconn#/connections'],
  ['connections-builtin', '?conntab=builtin#/connections'],
  ['connector-drawer', '?connector=feishu#/connections'],
  ['connectors-mcp', '?conntab=custom#/connections'],
  ['channels', '#/channels'],
  ['channel-drawer', '?channel=feishu#/channels'],
  ['extensions', '#/extensions'],
  ['extensions-market', '?ext=market#/extensions'],
  ['skills', '#/skills'],
  ['skills-packages', '?persskills=packages#/personalization'],
  ['skillpkg-drawer', '?skillpkg=1#/skills'],
  ['skill-create-drawer', '?skillcreate=1#/skills'],
  ['skills-market', '?persskills=market#/personalization'],
  ['personalization', '#/personalization'],
  ['usage', '#/usage'],
  ['settings', '#/settings'],
  ['admin', '#/admin'],
  ['admin-users', '#/admin-users'],
  ['admin-sso-feishu', '?usertab=feishu#/admin-users'],
  ['admin-sso-ldap', '?usertab=ldap#/admin-users'],
  ['admin-roles', '?usertab=roles#/admin-users'],
  ['admin-groups', '?usertab=groups#/admin-users'],
  ['admin-models', '#/admin-models'],
  ['admin-storage', '?storagetab=types#/admin-storage'],
  ['storage-drawer', '?storagetab=types&storagedrawer=1#/admin-storage'],
  ['model-embedding', '?mtab=embedding#/admin-models'],
  ['model-generation', '?mtab=generation#/admin-models'],
  ['model-voice', '?mtab=voice#/admin-models'],
  ['model-search', '?mtab=search#/admin-models'],
  ['admin-plugins', '#/admin-plugins'],
  ['plugins-market', '?plugintab=market#/admin-plugins'],
  ['provider-drawer', '?pvopen=1#/admin-models'],
  ['plugin-drawer', '?plugininstall=1#/admin-plugins'],
  ['admin-security', '#/admin-security'],
  ['admin-advanced', '#/admin-advanced'],
  ['admin-empty', '?state=adminempty#/admin'],
  ['workbench', '#/workbench'],
  ['wb-terminal', '?wbtab=terminal#/workbench'],
  ['wb-cloud', '?wbtab=cloud#/workbench'],
  ['bridge', '#/bridge'],
  ['bridge-empty', '?bridgeempty=1#/bridge'],
  ['bridge-drawer', '?bridgedrawer=1#/bridge'],
  ['error-403', '?error=403#/chat'],
  ['error-500', '?error=500#/chat'],
  ['list-error', '?state=listfail#/tasks'],
  ['login', '?error=401#/chat'],
  ['mobile-tasks', '#/tasks', { width: 500, height: 900 }],
];

const only = process.argv.slice(2);
const targets = only.length ? MANIFEST.filter(([name]) => only.includes(name)) : MANIFEST;

fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const failures = [];

for (const [name, hash, vp] of targets) {
  const context = await browser.newContext({
    viewport: vp || { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + hash, { waitUntil: 'load' });
  // 列表滚到顶部，避免不同机器上聊天记录的滚动位置不一致
  await page.evaluate(() => {
    const box = document.querySelector('#msgs');
    if (box) box.scrollTop = 0;
    const msgs = document.querySelector('.msgs');
    if (msgs) msgs.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  const jsError = await page.evaluate(() => document.documentElement.dataset.jsError || '');
  if (errors.length || jsError) failures.push([name, errors[0] || jsError]);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  await context.close();
  process.stdout.write((errors.length || jsError ? '!' : '.') + name + ' ');
}

await browser.close();
console.log('');
if (failures.length) {
  console.error('页面错误：');
  for (const [name, err] of failures) console.error(' -', name, ':', String(err).slice(0, 200));
  process.exitCode = 1;
} else {
  console.log(`完成 ${targets.length} 张截图 → prototype/shots/`);
}
