const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
let server, browser, origin;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg'};
    fs.readFile(file, (error, content) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'}); response.end(content);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage']});
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function newPage(t, options = {}) {
  const context = await browser.newContext({viewport: options.viewport || {width: 1440, height: 900}, timezoneId: options.timezone || 'UTC'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no uncaught browser errors'); });
  return page;
}
async function demo(page, hash = '') {
  await page.goto(`${origin}/?demo=1${hash}`);
  await page.waitForSelector('#connection-banner:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
}
async function registerOwner(page) {
  await page.locator('nav [data-go="account"]').click();
  await page.locator('[data-a="up"]').click();
  await page.locator('#a-mail').fill('musik5456@gmail.com');
  await page.locator('#a-pass').fill('demopass123');
  await page.locator('#a-go').click();
  await page.waitForSelector('#nav-admin:not([hidden])');
}
async function addManual(page, nick) {
  await page.locator('#ap-nick').fill(nick);
  await page.locator('#ap-add').click();
  await page.waitForFunction(() => document.querySelector('#ap-msg').textContent.includes('добавлен') && document.querySelector('#ap-nick').value === '');
  await page.waitForFunction(nick => document.querySelector('#ad-t').textContent.includes(nick), nick);
}
async function withFirebaseMock(page, {docs = {}, email = 'musik5456@gmail.com', uid = 'owner', failPath = null} = {}) {
  await page.addInitScript(({docs, email, uid, failPath}) => {
    globalThis.__fakeFirebase = {docs, failPath, commits: 0, auth: {currentUser: {uid, email, emailVerified: true, reload: async () => {}}}};
  }, {docs, email, uid, failPath});
  await page.route(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/(firebase-app|firebase-auth|firebase-firestore)\.js$/, async route => {
    const fixture = path.join(__dirname, 'fixtures', path.basename(new URL(route.request().url()).pathname));
    await route.fulfill({status: 200, contentType: 'application/javascript', headers: {'Access-Control-Allow-Origin': '*'}, body: fs.readFileSync(fixture, 'utf8')});
  });
}

test('navigation, format examples and browser history work on desktop', async t => {
  const page = await newPage(t); await demo(page);
  assert.equal(await page.locator('#home-title').textContent(), 'ТВОЯ ИГРА.ТВОЙ МОМЕНТ.');
  await page.locator('nav [data-go="format"]').click();
  assert.equal(new URL(page.url()).hash, '#format');
  assert.equal(await page.locator('#m-solo .rd').count(), 4);
  await page.locator('#m-solo [data-n="8"]').click();
  assert.equal(await page.locator('#m-solo .rd').count(), 3);
  assert.equal(await page.locator('#m-solo .slots').textContent(), '8 игроков');
  await page.locator('#format-mode [data-mode="duo"]').click();
  assert.equal(await page.locator('#m-duo').isVisible(), true);
  assert.equal(await page.locator('#m-duo .rd').count(), 4);
  await page.locator('nav [data-go="rules"]').click();
  await page.goBack();
  await page.waitForSelector('#format.on');
  assert.equal(await page.locator('#m-duo').isVisible(), true);
  const dimensions = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, viewport: innerWidth}));
  assert.equal(dimensions.scroll, dimensions.viewport);
});

test('mobile menu is keyboard accessible and layout does not overflow', async t => {
  const page = await newPage(t, {viewport: {width: 375, height: 812}}); await demo(page);
  assert.equal(await page.locator('#nav-toggle').isVisible(), true);
  await page.locator('#nav-toggle').click();
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#nav-toggle').click();
  await page.locator('nav [data-go="bracket"]').click();
  await page.waitForSelector('#bracket.on');
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await page.setViewportSize({width: 1280, height: 800});
  assert.equal(await page.locator('nav [data-go="home"]').isVisible(), true);
});

test('registration validates Steam and duo, keeps success visible, and locks the account email', async t => {
  const page = await newPage(t); await demo(page, '#apply');
  await page.locator('#f-nick').fill('Player');
  await page.locator('#f-mail').fill('player@example.com');
  await page.locator('#f-pw').fill('demopass123');
  await page.locator('#f-faceit').fill('https://steamcommunity.com.evil.test/id/player');
  await page.locator('#send').click();
  assert.match(await page.locator('#f-err').textContent(), /ссылку на профиль Steam/);
  assert.equal(await page.evaluate(() => localStorage.getItem('ah_users')), null);
  await page.locator('#f-faceit').fill('https://steamcommunity.com/id/player');
  await page.locator('#send').click();
  await page.waitForSelector('#res:not([hidden])');
  assert.equal(await page.locator('#apply').getAttribute('class'), 'on');
  assert.equal(await page.locator('#f-mail').evaluate(element => element.readOnly), true);
  assert.equal(await page.locator('#f-pw').inputValue(), '');
  assert.doesNotMatch(await page.evaluate(() => localStorage.getItem('ah_users')), /demopass123/);
  await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#f-err').textContent.includes('уже зарегистрированы'));
  await page.locator('#f-mode [data-m="duo"]').click();
  await page.locator('#f-partner').fill('Player');
  await page.locator('#send').click();
  assert.match(await page.locator('#f-err').textContent(), /другого игрока/);
  await page.locator('#f-partner').fill('Partner');
  await page.locator('#send').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ah_apps')).length === 2);
  await page.locator('#res [data-go="account"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#a-apps .application-item').length === 2);
  assert.equal(await page.locator('#a-reg').isVisible(), true);
  assert.match(await page.locator('#a-apps').innerText(), /На проверке/);
});

test('admin scores, byes and reordering cannot leave stale downstream results', async t => {
  const page = await newPage(t); await demo(page); await registerOwner(page);
  await page.locator('#nav-admin').click(); await page.waitForSelector('#ad-t table');
  for (const nick of ['Alice', 'Bob', 'Carol', 'Dave']) await addManual(page, nick);
  await page.locator('nav [data-go="bracket"]').click();
  await page.waitForFunction(() => document.querySelector('#br-status').textContent.includes('4 / 16'));
  const rounds = page.locator('#br-solo .rd');
  let answers = [];
  page.on('dialog', dialog => { const answer = answers.shift(); return dialog.type() === 'prompt' ? dialog.accept(answer) : dialog.accept(); });
  answers.push('2:1'); await rounds.nth(0).locator('.m').nth(0).locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['0-0'] === '2:1');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.ah_apps).map(item => item.pos)), [0, 1, 2, 3], 'recording a score fixes participant positions');
  assert.equal(await rounds.nth(1).locator('.m').first().locator('button.sc').count(), 0, 'unplayed opponent is not treated as a bye');
  answers.push('2:0'); await rounds.nth(0).locator('.m').nth(1).locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['0-1'] === '2:0');
  answers.push('2:1'); await rounds.nth(1).locator('.m').first().locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['1-0'] === '2:1');
  await rounds.nth(2).locator('.m').first().locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['2-0'] === 'bye:0');
  await rounds.nth(3).locator('.m').first().locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['3-0'] === 'bye:0');
  assert.match(await page.locator('#br-solo .champ').textContent(), /Alice/);
  answers.push('0:2'); await rounds.nth(0).locator('.m').first().locator('button.sc').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_results).solo['0-0'] === '0:2');
  const scores = await page.evaluate(() => JSON.parse(localStorage.ah_results).solo);
  assert.equal(scores['1-0'], undefined); assert.equal(scores['2-0'], undefined); assert.equal(scores['3-0'], undefined);
  assert.equal(await page.locator('#br-solo .champ').count(), 0);
  await page.locator('#br-player').selectOption({index: 0});
  await page.locator('#br-position').selectOption('4');
  await page.locator('#br-move').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_apps).find(item => item.nick === 'Alice').pos === 4);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.ah_results).solo), {});
});

test('moving an existing application to the other mode cannot overwrite a later application', async t => {
  const page = await newPage(t); await demo(page, '#apply');
  await page.locator('#f-nick').fill('Player'); await page.locator('#f-mail').fill('player@example.com');
  await page.locator('#f-pw').fill('demopass123'); await page.locator('#f-faceit').fill('https://steamcommunity.com/id/player');
  await page.locator('#send').click(); await page.waitForSelector('#res:not([hidden])');
  await page.locator('#res [data-go="account"]').click(); await page.locator('#a-exit').click();
  await page.waitForSelector('#a-out:not([hidden])'); await page.locator('[data-a="up"]').click();
  await page.locator('#a-mail').fill('musik5456@gmail.com'); await page.locator('#a-pass').fill('ownerpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click();
  await page.waitForFunction(() => document.querySelector('#ad-t').textContent.includes('Player'));
  page.once('dialog', dialog => dialog.accept('Partner'));
  await page.locator('#ad-t [data-action="move"]').first().click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_apps).some(item => item.nick === 'Player' && item.mode === 'duo'));
  await page.locator('#nav-cta').click(); await page.locator('#a-exit').click(); await page.waitForSelector('#a-out:not([hidden])');
  await page.locator('[data-a="in"]').click(); await page.locator('#a-mail').fill('player@example.com'); await page.locator('#a-pass').fill('demopass123'); await page.locator('#a-go').click();
  await page.waitForSelector('#a-in:not([hidden])'); await page.locator('#a-reg').click();
  await page.locator('#f-nick').fill('Player'); await page.locator('#f-faceit').fill('https://steamcommunity.com/id/player'); await page.locator('#send').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_apps).filter(item => item.uid === 'u1').length === 2);
  const apps = await page.evaluate(() => JSON.parse(localStorage.ah_apps).filter(item => item.uid === 'u1'));
  assert.deepEqual(apps.map(item => item.mode).sort(), ['duo', 'solo']);
  assert.equal(new Set(apps.map(item => item.id)).size, 2);
  assert.equal(apps.find(item => item.mode === 'duo').partner, 'Partner');
});

test('a failed Firebase connection never silently turns a real application into a demo', async t => {
  const page = await newPage(t);
  await page.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, route => route.abort());
  await page.goto(`${origin}/#apply`);
  await page.waitForSelector('#connection-banner:not([hidden])');
  assert.match(await page.locator('#connection-title').textContent(), /Нет подключения/);
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('ah_users')), null);
  assert.match(await page.locator('#demo-link').getAttribute('href'), /demo=1/);
});

test('Firebase batches are atomic and permission failures are not reported as duplicates', async t => {
  const page = await newPage(t);
  await withFirebaseMock(page, {email: 'player@example.com', uid: 'player', docs: {'cfg/main': {admins: []}}, failPath: 'slots/player_solo'});
  await page.goto(`${origin}/#apply`);
  await page.waitForFunction(() => !document.querySelector('#send').disabled && document.querySelector('#f-mail').readOnly);
  await page.locator('#f-nick').fill('Player'); await page.locator('#f-faceit').fill('https://steamcommunity.com/id/player');
  await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#f-err').textContent.includes('Firebase отклонил доступ'));
  assert.equal(await page.evaluate(() => !!__fakeFirebase.docs['apps/player_solo']), false);
  assert.equal(await page.evaluate(() => !!__fakeFirebase.docs['slots/player_solo']), false);
  await page.evaluate(() => { __fakeFirebase.failPath = null; });
  await page.locator('#send').click(); await page.waitForSelector('#res:not([hidden])');
  const docs = await page.evaluate(() => __fakeFirebase.docs);
  assert.equal(docs['apps/player_solo'].email, 'player@example.com');
  assert.equal(docs['slots/player_solo'].nick, 'Player');
  assert.equal(docs['slots/player_solo'].email, undefined, 'public slots contain no email');
});

test('an intentionally empty main admin list does not revive a stale legacy admin', async t => {
  const page = await newPage(t);
  await withFirebaseMock(page, {docs: {'cfg/main': {admins: []}, 'cfg/admins': {emails: ['stale@example.com']}}});
  await page.goto(`${origin}/`); await page.waitForSelector('#nav-admin:not([hidden])');
  await page.locator('#nav-admin').click(); await page.locator('#ad-tab-adm').click();
  assert.doesNotMatch(await page.locator('#ad-list').innerText(), /stale@example.com/);
  await page.locator('#ad-new').fill('new@example.com'); await page.locator('#ad-add').click();
  await page.waitForFunction(() => document.querySelector('#ad-list').textContent.includes('new@example.com'));
  page.once('dialog', dialog => dialog.accept()); await page.locator('#ad-list [data-mail="new@example.com"]').click();
  await page.waitForFunction(() => !document.querySelector('#ad-list').textContent.includes('new@example.com'));
  assert.deepEqual(await page.evaluate(() => __fakeFirebase.docs['cfg/main'].admins), []);
  await page.reload(); await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click(); await page.locator('#ad-tab-adm').click();
  assert.doesNotMatch(await page.locator('#ad-list').innerText(), /stale@example.com|new@example.com/);
});

test('start time is saved as UTC and shown in the visitor timezone', async t => {
  const page = await newPage(t, {timezone: 'Europe/Kyiv'}); await demo(page); await registerOwner(page);
  await page.locator('#nav-admin').click(); await page.locator('#ad-tabs [data-t="set"]').click();
  await page.locator('#ad-start').fill('2030-05-21T18:30');
  const expected = await page.evaluate(() => new Date('2030-05-21T18:30').toISOString());
  await page.locator('#ad-save').click();
  await page.waitForFunction(() => document.querySelector('#ad-date-msg').textContent.includes('сохранена'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.ah_start)), expected);
  assert.match(expected, /Z$/);
  await page.locator('nav [data-go="home"]').click();
  assert.match(await page.locator('#next-date').textContent(), /18:30/);
  assert.equal(await page.locator('#cd').isVisible(), true);
});

test('untrusted application and ranking data are rendered as text, not markup', async t => {
  const page = await newPage(t);
  const nick = '<img src=x onerror=alert(1)>';
  await withFirebaseMock(page, {docs: {
    'cfg/main': {admins: []},
    'apps/evil_solo': {uid: 'evil', email: 'evil@example.com', mode: 'solo', nick, partner: '', faceit: 'https://steamcommunity.com.evil.test/id/evil', status: 'ok', t: 1},
    'slots/evil_solo': {uid: 'evil', mode: 'solo', nick, partner: '', status: 'ok', t: 1},
    'stats/evil': {nick, matches: 1, kills: 5, deaths: 2}
  }});
  await page.goto(`${origin}/`); await page.waitForSelector('#nav-admin:not([hidden])');
  await page.locator('#nav-admin').click(); await page.waitForFunction(() => document.querySelector('#ad-t').textContent.includes('<img'));
  assert.equal(await page.locator('#ad-t img').count(), 0);
  assert.equal(await page.locator('#ad-t a').count(), 0, 'untrusted Steam host is not turned into a link');
  await page.locator('nav [data-go="top"]').click(); await page.waitForFunction(() => document.querySelector('#top-t').textContent.includes('<img'));
  assert.equal(await page.locator('#top-t img').count(), 0);
});

test('admin cannot approve more than sixteen participants in a mode', async t => {
  const page = await newPage(t);
  await page.addInitScript(() => {
    localStorage.setItem('ah_me', JSON.stringify({uid: 'owner', email: 'musik5456@gmail.com'}));
    const apps = Array.from({length: 17}, (_, index) => ({id: `entry${index}`, uid: `u${index}`, email: `p${index}@example.com`, mode: 'solo', nick: `Player${index}`, partner: '', status: index === 16 ? 'new' : 'ok', t: index}));
    localStorage.setItem('ah_apps', JSON.stringify(apps));
  });
  await demo(page); await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click();
  await page.waitForSelector('#ad-t [data-id="entry16"][data-action="ok"]');
  await page.locator('#ad-t [data-id="entry16"][data-action="ok"]').click();
  await page.waitForFunction(() => document.querySelector('#ad-action-msg').textContent.includes('все 16 мест'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.ah_apps).find(item => item.id === 'entry16').status), 'new');
});

test('owner can grant and revoke admin access in demo without losing the list', async t => {
  const page = await newPage(t); await demo(page);
  await page.locator('nav [data-go="account"]').click(); await page.locator('[data-a="up"]').click();
  await page.locator('#a-mail').fill('helper@example.com'); await page.locator('#a-pass').fill('helperpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#a-in:not([hidden])'); await page.locator('#a-exit').click(); await page.waitForSelector('#a-out:not([hidden])');
  await page.locator('#a-mail').fill('musik5456@gmail.com'); await page.locator('#a-pass').fill('ownerpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click(); await page.locator('#ad-tab-adm').click();
  await page.waitForSelector('#ad-picks [data-mail="helper@example.com"]');
  await page.locator('#ad-picks [data-mail="helper@example.com"]').click(); await page.locator('#ad-add').click();
  await page.waitForSelector('#ad-list [data-mail="helper@example.com"]');
  await page.locator('#nav-cta').click(); await page.locator('#a-exit').click(); await page.waitForSelector('#a-out:not([hidden])');
  await page.locator('[data-a="in"]').click(); await page.locator('#a-mail').fill('helper@example.com'); await page.locator('#a-pass').fill('helperpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#nav-admin:not([hidden])');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.ah_admins)), ['helper@example.com']);
  await page.locator('#nav-cta').click(); await page.locator('#a-exit').click(); await page.waitForSelector('#a-out:not([hidden])');
  await page.locator('#a-mail').fill('musik5456@gmail.com'); await page.locator('#a-pass').fill('ownerpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click(); await page.locator('#ad-tab-adm').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ad-list [data-mail="helper@example.com"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_admins).length === 0);
  await page.locator('#nav-cta').click(); await page.locator('#a-exit').click(); await page.waitForSelector('#a-out:not([hidden])');
  await page.locator('#a-mail').fill('helper@example.com'); await page.locator('#a-pass').fill('helperpass'); await page.locator('#a-go').click();
  await page.waitForSelector('#a-in:not([hidden])');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#nav-admin').isVisible(), false);
});

test('a rejected Firebase date write does not change the displayed start time', async t => {
  const page = await newPage(t);
  const oldStart = '2030-05-21T15:30:00.000Z';
  await withFirebaseMock(page, {docs: {'cfg/main': {admins: [], start: oldStart}}, failPath: 'cfg/main'});
  await page.goto(`${origin}/`); await page.waitForSelector('#nav-admin:not([hidden])');
  await page.locator('#nav-admin').click(); await page.locator('#ad-tabs [data-t="set"]').click();
  await page.waitForFunction(() => document.querySelector('#ad-start').value !== '');
  await page.locator('#ad-start').fill('2031-06-22T18:30'); await page.locator('#ad-save').click();
  await page.waitForFunction(() => document.querySelector('#ad-date-msg').textContent.includes('Firebase отклонил доступ'));
  assert.equal(await page.evaluate(() => __fakeFirebase.docs['cfg/main'].start), oldStart);
  await page.locator('nav [data-go="home"]').click();
  assert.match(await page.locator('#next-date').textContent(), /2030/);
});

test('pending legacy slots keep their positions and cannot inherit or advance a score', async t => {
  const page = await newPage(t);
  await page.addInitScript(() => {
    localStorage.setItem('ah_me', JSON.stringify({uid: 'owner', email: 'musik5456@gmail.com'}));
    const apps = ['Alice', 'Bob', 'Carol', 'Dave'].map((nick, index) => ({id: `entry${index}`, uid: `u${index}`, email: `p${index}@example.com`, mode: 'solo', nick, partner: '', status: index === 1 ? 'new' : 'ok', t: index + 1}));
    localStorage.setItem('ah_apps', JSON.stringify(apps));
    localStorage.setItem('ah_results', JSON.stringify({solo: {'0-0': '2:0', '0-1': '2:1'}}));
  });
  await demo(page, '#bracket');
  await page.waitForFunction(() => document.querySelector('#br-status').textContent.includes('3 / 16'));
  const firstRound = page.locator('#br-solo .rd').first();
  assert.deepEqual(await firstRound.locator('.m').nth(0).locator(':scope > span').allTextContents(), ['Alice', 'Bob']);
  assert.equal(await firstRound.locator('.m').nth(0).locator('button.sc').count(), 0, 'pending match score is hidden and cannot be edited');
  assert.equal(await firstRound.locator('.m').nth(0).locator('span.pend').textContent(), 'Bob');
  assert.match(await firstRound.locator('.m').nth(1).locator('button.sc').textContent(), /2 : 1/);
  const next = page.locator('#br-solo .rd').nth(1).locator('.m').first();
  assert.deepEqual(await next.locator(':scope > span').allTextContents(), ['—', 'Carol']);
  assert.equal(await next.locator('button.sc').count(), 0, 'unresolved pending opponent is not a bye');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#br-lock').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_apps).every((item, index) => item.pos === index));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.ah_results).solo['0-1']), '2:1', 'locking positions keeps legacy scores');
  await page.evaluate(() => {
    const apps = JSON.parse(localStorage.ah_apps);
    apps.push({id: 'late', uid: 'late', email: 'late@example.com', mode: 'solo', nick: 'Late', partner: '', status: 'new', t: 0});
    localStorage.ah_apps = JSON.stringify(apps);
  });
  await page.locator('nav [data-go="home"]').click(); await page.locator('nav [data-go="bracket"]').click();
  await page.waitForFunction(() => document.querySelector('#br-solo .rd .m:nth-child(3)').textContent.includes('Late'));
  assert.deepEqual(await firstRound.locator('.m').nth(1).locator(':scope > span').allTextContents(), ['Carol', 'Dave']);
  assert.match(await firstRound.locator('.m').nth(1).locator('button.sc').textContent(), /2 : 1/);
});

test('rejecting a pending participant clears positional results before that place is reused', async t => {
  const page = await newPage(t);
  await page.addInitScript(() => {
    localStorage.setItem('ah_me', JSON.stringify({uid: 'owner', email: 'musik5456@gmail.com'}));
    localStorage.setItem('ah_apps', JSON.stringify([
      {id: 'a', uid: 'a', email: 'a@example.com', mode: 'solo', nick: 'Alice', status: 'ok', t: 1},
      {id: 'b', uid: 'b', email: 'b@example.com', mode: 'solo', nick: 'Bob', status: 'new', t: 2}
    ]));
    localStorage.setItem('ah_results', JSON.stringify({solo: {'0-0': '2:1'}}));
  });
  await demo(page); await page.waitForSelector('#nav-admin:not([hidden])'); await page.locator('#nav-admin').click();
  await page.waitForSelector('#ad-t [data-id="b"][data-action="no"]');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ad-t [data-id="b"][data-action="no"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.ah_apps).find(item => item.id === 'b').status === 'no');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.ah_results).solo), {});
});

test('Firebase score writes and participant positions are committed together', async t => {
  const page = await newPage(t);
  await withFirebaseMock(page, {docs: {
    'cfg/main': {admins: []},
    'slots/a': {uid: 'a', mode: 'solo', nick: 'Alice', partner: '', status: 'ok', t: 1},
    'slots/b': {uid: 'b', mode: 'solo', nick: 'Bob', partner: '', status: 'ok', t: 2}
  }, failPath: 'slots/b'});
  await page.goto(`${origin}/#bracket`);
  await page.waitForSelector('#nav-admin:not([hidden])');
  const score = page.locator('#br-solo .rd').first().locator('.m').first().locator('button.sc');
  await score.waitFor();
  let alerts = [];
  page.on('dialog', dialog => { if (dialog.type() === 'prompt') return dialog.accept('2:1'); alerts.push(dialog.message()); return dialog.accept(); });
  await score.click(); await page.waitForFunction(() => __fakeFirebase.failPath && !__fakeFirebase.docs['results/solo']);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => __fakeFirebase.docs['slots/a'].pos), undefined);
  assert.equal(await page.evaluate(() => __fakeFirebase.docs['slots/b'].pos), undefined);
  assert.ok(alerts.some(message => message.includes('Firebase отклонил доступ')));
  await page.evaluate(() => { __fakeFirebase.failPath = null; });
  await score.click();
  await page.waitForFunction(() => __fakeFirebase.docs['results/solo']?.s?.['0-0'] === '2:1');
  assert.equal(await page.evaluate(() => __fakeFirebase.docs['slots/a'].pos), 0);
  assert.equal(await page.evaluate(() => __fakeFirebase.docs['slots/b'].pos), 1);
});
