const fs = require('node:fs')
const path = require('node:path')

function experimentFolder(datasetRoot, group, name) {
  const root = path.join(datasetRoot, 'experiments')
  const legacy = path.join(root, name)
  const organized = path.join(root, group, name)
  if (!fs.existsSync(legacy)) return organized
  if (fs.existsSync(organized)) {
    throw new Error(`Ambiguous experiment: ${legacy} and ${organized}`)
  }
  return legacy
}

module.exports = { experimentFolder }
