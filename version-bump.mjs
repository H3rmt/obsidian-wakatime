import {readFileSync, writeFileSync} from "fs";

const targetVersion = process.argv[2];
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
