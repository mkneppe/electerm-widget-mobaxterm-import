/**
 * electerm widget: read MobaXterm sessions (MobaXterm.ini or an exported
 * .mxtsessions file) and offer them as electerm bookmarks. Nothing is
 * written here, electerm imports them when the user confirms.
 */

const fs = require('fs')
const path = require('path')
const { parseMobaXterm, decodeMobaXterm } = require('./mobaxterm')

// installed MobaXterm; the portable one keeps MobaXterm.ini next to its exe
function defaultFile () {
  return path.join(process.env.APPDATA || '', 'MobaXterm', 'MobaXterm.ini')
}

async function run (values = {}) {
  const file = (values.file || '').trim() || defaultFile()
  let bytes
  try {
    bytes = await fs.promises.readFile(file)
  } catch (e) {
    return {
      message: `Cannot read ${file}: ${e.message}`,
      messageType: 'error'
    }
  }
  const group = (values.group || '').trim() ||
    'MobaXterm ' + new Date().toISOString().slice(0, 10)
  const { bookmarks, bookmarkGroups, skipped } = parseMobaXterm(
    decodeMobaXterm(bytes), group
  )
  if (!bookmarks.length) {
    return {
      message: `No supported sessions in ${file}`,
      messageType: 'warning',
      details: skipped.length
        ? [{ label: 'Not supported', value: skipped.join(', ') }]
        : undefined
    }
  }
  return {
    message: `${bookmarks.length} sessions found, group "${group}"`,
    messageType: 'success',
    details: [
      { label: 'File', value: file },
      ...(skipped.length
        ? [{ label: 'Not supported', value: skipped.join(', ') }]
        : []),
      { label: 'Passwords', value: 'not in the file, asked on first connect' }
    ],
    bookmarks: { bookmarks, bookmarkGroups }
  }
}

module.exports = {
  run,
  defaultFile
}
