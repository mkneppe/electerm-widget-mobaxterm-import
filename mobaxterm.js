/**
 * convert MobaXterm sessions (MobaXterm.ini or an exported .mxtsessions
 * file) to electerm bookmarks and bookmark groups
 *
 * [Bookmarks], [Bookmarks_1], ...: one section per folder, SubRep is the
 * folder path (`a\b`, empty for the root), every other key is a session:
 *   name=<flag>#<icon>#<type>%<host>%<port>%...#<terminal>#<start mode>#<comment>#...
 * Field positions: https://gist.github.com/Ruzgfpegk/ab597838e4abbe8de30d7224afd062ea
 * Passwords are not in the file (MobaXterm keeps them encrypted elsewhere).
 */

const crypto = require('crypto')

const uid = () => crypto.randomBytes(6).toString('base64url')

const escapes = {
  __PTVIRG__: ';',
  __DBLQUO__: '"',
  __PIPE__: '|',
  __DIEZE__: '#',
  __PERCENT__: '%'
}

// MobaXterm path placeholders, `~` is expanded when the key is read
const pathVars = [
  [/^_ProfileDir_/, '~'],
  [/^_AppDataDir_/, '~\\AppData\\Roaming'],
  [/^_MyDocuments_/, '~\\Documents'],
  [/^_CurrentDrive_:?/, 'C:']
]

// MobaXterm writes a single space for some empty fields (key path, comment)
function unescape (s = '') {
  return s.replace(/__[A-Z]+__/g, m => escapes[m] ?? m).trim()
}

function keyPath (s) {
  const p = unescape(s)
  return pathVars.reduce((r, [re, to]) => r.replace(re, to), p)
}

function port (s, def) {
  const n = parseInt(s, 10)
  return n > 0 && n < 65536 ? n : def
}

const on = s => s === '-1'

function auth (key) {
  const p = keyPath(key)
  return p
    ? { authType: 'privateKey', privateKeyPath: p }
    : { authType: 'password' }
}

// gateway hosts, ports, users and keys are __PIPE__ separated lists
function hoppings (f, hostI, portI, userI, keyI) {
  const list = n => (f[n] || '').split('__PIPE__')
  const ports = list(portI)
  const users = list(userI)
  const keys = list(keyI)
  return list(hostI)
    .map((host, i) => host && {
      host: unescape(host),
      port: port(ports[i], 22),
      username: unescape(users[i]),
      ...auth(keys[i])
    })
    .filter(Boolean)
}

const sessionTypes = {
  // ssh
  0: f => ({
    type: 'ssh',
    host: f[1],
    port: port(f[2], 22),
    username: unescape(f[3]),
    x11: on(f[5]),
    ...(f[7] ? { runScripts: [{ delay: 500, script: unescape(f[7]) }] } : {}),
    connectionHoppings: hoppings(f, 8, 9, 10, 15),
    ...auth(f[14]),
    ...(f[33] ? { useSshAgent: on(f[33]) } : {}),
    ...(f[34] ? { agentForward: on(f[34]) } : {})
  }),
  // telnet
  1: f => ({
    type: 'telnet',
    host: f[1],
    port: port(f[2], 23)
  }),
  // rdp
  4: f => ({
    type: 'rdp',
    host: f[1] || 'localhost',
    port: port(f[2], 3389),
    username: unescape(f[3]),
    connectionHoppings: hoppings(f, 13, 14, 15, 18)
  }),
  // vnc
  5: f => ({
    type: 'vnc',
    host: f[1],
    port: port(f[2], 5900),
    scaleViewport: on(f[3]),
    viewOnly: on(f[4]),
    connectionHoppings: hoppings(f, 5, 6, 7, 8)
  }),
  // sftp: ssh bookmark without terminal
  7: f => ({
    type: 'ssh',
    host: f[1],
    port: port(f[2], 22),
    username: unescape(f[3]),
    enableSsh: false,
    enableSftp: true,
    ...auth(f[9])
  })
}

function parseIni (text) {
  const sections = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      cur = { name: sec[1], items: [] }
      sections.push(cur)
      continue
    }
    const i = line.indexOf('=')
    if (cur && i > 0) {
      cur.items.push([line.slice(0, i), line.slice(i + 1)])
    }
  }
  return sections
}

/**
 * @param {string} name session name
 * @param {string} value session string
 * @return {object | null} bookmark, null for unsupported session types
 */
function parseMobaSession (name, value) {
  const parts = value.split('#')
  const f = (parts[2] || '').split('%')
  const build = sessionTypes[f[0]]
  if (!build || !f[1]) {
    return null
  }
  const bookmark = build(f)
  if (!bookmark.connectionHoppings?.length) {
    delete bookmark.connectionHoppings
  } else {
    bookmark.hasHopping = true
  }
  return {
    id: uid(),
    title: name,
    // empty is MobaXterm's "windows user", electerm would fill in root
    username: '',
    ...bookmark,
    host: unescape(bookmark.host),
    description: unescape(parts[5] || '').trim()
  }
}

/**
 * @param {string} text file content
 * @param {string} rootTitle group that takes the root sessions and folders
 * @return {{bookmarks: object[], bookmarkGroups: object[], skipped: string[]}}
 */
function parseMobaXterm (text, rootTitle = 'MobaXterm') {
  const bookmarks = []
  const skipped = []
  const root = {
    id: uid(),
    title: rootTitle,
    level: 1,
    bookmarkIds: [],
    bookmarkGroupIds: []
  }
  const groups = { '': root }
  // folders may come before their parent folder
  const getGroup = path => {
    if (groups[path]) {
      return groups[path]
    }
    const i = path.lastIndexOf('\\')
    const parent = getGroup(i < 0 ? '' : path.slice(0, i))
    const g = {
      id: uid(),
      title: path.slice(i + 1),
      level: 2,
      bookmarkIds: [],
      bookmarkGroupIds: []
    }
    parent.bookmarkGroupIds.push(g.id)
    groups[path] = g
    return g
  }
  for (const sec of parseIni(text)) {
    if (!/^Bookmarks(_\d+)?$/.test(sec.name)) {
      continue
    }
    const subRep = sec.items.find(([k]) => k === 'SubRep')?.[1] || ''
    const group = getGroup(subRep.replace(/^\\+|\\+$/g, ''))
    for (const [k, v] of sec.items) {
      if (k === 'SubRep' || k === 'ImgNum') {
        continue
      }
      const bm = parseMobaSession(k, v)
      if (bm) {
        bookmarks.push(bm)
        group.bookmarkIds.push(bm.id)
      } else {
        skipped.push(k)
      }
    }
  }
  return {
    bookmarks,
    bookmarkGroups: Object.values(groups),
    skipped
  }
}

function isMobaXtermFile (name = '', text = '') {
  return /\.(mxtsessions|ini)$/i.test(name) || /^\s*\[Bookmarks(_\d+)?\]/m.test(text)
}

/**
 * MobaXterm writes the file in the windows ansi codepage, newer
 * versions may use utf-8
 * @param {Uint8Array} bytes
 */
function decodeMobaXterm (bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (e) {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

module.exports = {
  parseMobaSession,
  parseMobaXterm,
  isMobaXtermFile,
  decodeMobaXterm
}
