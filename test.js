const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  parseMobaXterm,
  parseMobaSession,
  isMobaXtermFile,
  decodeMobaXterm
} = require('./mobaxterm')
const { run } = require('./main')

const term = '#MobaFont%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%-1%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%0%-1'
const ssh = (f, comment = '') => ` #109#0%${f}${term}#0#${comment}#-1`

const ini = [
  '[Bookmarks]',
  'SubRep=',
  'ImgNum=42',
  'web01=' + ssh('web01.lan%2222%admin%%-1%-1%uptime%jump.lan%22%jumper%0%0%0%_ProfileDir_\\.ssh\\id_ed25519.ppk%%-1%0%0%0%%1080%%0%0%1', 'prod __DIEZE__1'),
  'tel=#98#1%router%23%%' + term + '#0##-1',
  'file=#84#9%C:\\%' + term + '#0##-1',
  '',
  '[Bookmarks_2]',
  'SubRep=Kunden\\A',
  'ImgNum=41',
  'rdp-a=#91#4%win.a%3390%Administrator%0%0%-1%0%0%0%0%%%%%%2%0%%0%%%%%%%%%%%%%%#0##-1',
  '',
  '[Bookmarks_1]',
  'SubRep=Kunden',
  'ImgNum=41',
  'vnc=#128#5%vnc.k%5901%-1%-1%%%%%' + term + '#0##-1',
  'sftp=#140#7%files.k%22%up%-1%0%%0%0%_CurrentDrive_:\\keys\\k.ppk%0%%%%%%0#0##-1',
  '',
  '[Misc]',
  'x=1'
].join('\r\n')

describe('mobaxterm import', () => {
  test('ssh session fields', () => {
    const { bookmarks } = parseMobaXterm(ini)
    const b = bookmarks.find(b => b.title === 'web01')
    assert.equal(b.type, 'ssh')
    assert.equal(b.host, 'web01.lan')
    assert.equal(b.port, 2222)
    assert.equal(b.username, 'admin')
    assert.equal(b.x11, true)
    assert.equal(b.authType, 'privateKey')
    assert.equal(b.privateKeyPath, '~\\.ssh\\id_ed25519.ppk')
    assert.deepEqual(b.runScripts, [{ delay: 500, script: 'uptime' }])
    assert.equal(b.description, 'prod #1')
    assert.equal(b.hasHopping, true)
    assert.deepEqual(b.connectionHoppings, [{
      host: 'jump.lan', port: 22, username: 'jumper', authType: 'password'
    }])
  })

  test('other session types', () => {
    const { bookmarks, skipped } = parseMobaXterm(ini)
    const by = t => bookmarks.find(b => b.title === t)
    assert.deepEqual(
      [by('tel').type, by('tel').host, by('tel').port],
      ['telnet', 'router', 23]
    )
    assert.deepEqual(
      [by('rdp-a').type, by('rdp-a').port, by('rdp-a').username],
      ['rdp', 3390, 'Administrator']
    )
    assert.equal(by('rdp-a').connectionHoppings, undefined)
    assert.deepEqual(
      [by('vnc').type, by('vnc').port, by('vnc').scaleViewport, by('vnc').viewOnly],
      ['vnc', 5901, true, true]
    )
    const s = by('sftp')
    assert.deepEqual(
      [s.type, s.enableSsh, s.enableSftp, s.username, s.privateKeyPath],
      ['ssh', false, true, 'up', 'C:\\keys\\k.ppk']
    )
    assert.deepEqual(skipped, ['file'])
  })

  test('folders become nested groups under one root group', () => {
    const { bookmarks, bookmarkGroups } = parseMobaXterm(ini, 'Moba')
    const [root, ...rest] = bookmarkGroups
    assert.equal(root.title, 'Moba')
    assert.equal(root.level, 1)
    const kunden = rest.find(g => g.title === 'Kunden')
    const a = rest.find(g => g.title === 'A')
    assert.deepEqual(root.bookmarkGroupIds, [kunden.id])
    assert.deepEqual(kunden.bookmarkGroupIds, [a.id])
    assert.equal(a.level, 2)
    const ids = g => g.bookmarkIds.map(id => bookmarks.find(b => b.id === id).title)
    assert.deepEqual(ids(root), ['web01', 'tel'])
    assert.deepEqual(ids(kunden), ['vnc', 'sftp'])
    assert.deepEqual(ids(a), ['rdp-a'])
  })

  test('a single space is an empty field', () => {
    const b = parseMobaSession('x', ssh('h%22%u%%0%0%%%22%%0%0%0% %%-1'))
    assert.equal(b.authType, 'password')
    assert.equal(b.privateKeyPath, undefined)
    assert.equal(parseMobaSession('y', ssh('h%22% u %', ' ')).username, 'u')
  })

  test('unsupported or empty sessions', () => {
    assert.equal(parseMobaSession('x', ''), null)
    assert.equal(parseMobaSession('x', '#109#0%%22%' + term), null)
  })

  test('file detection and ansi decoding', () => {
    assert.equal(isMobaXtermFile('C:\\x\\MobaXterm.ini'), true)
    assert.equal(isMobaXtermFile('s.mxtsessions'), true)
    assert.equal(isMobaXtermFile('b.json', '{"bookmarks":[]}'), false)
    assert.equal(isMobaXtermFile('', '[Bookmarks]\r\nSubRep=\r\n'), true)
    // "Büro" in windows-1252
    const ansi = Uint8Array.from([0x42, 0xfc, 0x72, 0x6f])
    assert.equal(decodeMobaXterm(ansi), 'Büro')
    assert.equal(decodeMobaXterm(new TextEncoder().encode('Büro')), 'Büro')
  })
})

describe('widget run', () => {
  test('offers the sessions of a windows-1252 file', async () => {
    const file = path.join(os.tmpdir(), 'moba-widget-test.mxtsessions')
    fs.writeFileSync(file, Buffer.from(ini.replace('Kunden', 'K\xfcnden'), 'latin1'))
    const r = await run({ file, group: 'G' })
    fs.unlinkSync(file)
    assert.equal(r.messageType, 'success')
    const { bookmarks, bookmarkGroups } = r.bookmarks
    assert.equal(bookmarks.length, 5)
    assert.equal(bookmarkGroups[0].title, 'G')
    assert.ok(bookmarkGroups.some(g => g.title === 'Künden'))
    assert.equal(bookmarks.find(b => b.title === 'tel').username, '')
    assert.equal(bookmarks.find(b => b.title === 'web01').username, 'admin')
  })

  test('missing file', async () => {
    const r = await run({ file: path.join(os.tmpdir(), 'nope.ini') })
    assert.equal(r.messageType, 'error')
    assert.equal(r.bookmarks, undefined)
  })
})
