import { readFileSync, writeFileSync } from "node:fs"

const manifestPath = new URL("../plugin/herdr-plugin.toml", import.meta.url)
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const manifest = readFileSync(manifestPath, "utf8")
writeFileSync(manifestPath, manifest.replace(/^version = ".*"$/m, `version = "${version}"`))
