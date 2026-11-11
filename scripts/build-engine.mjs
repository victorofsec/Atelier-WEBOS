import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['build.mjs'],{cwd:new URL('../browser-engine/',import.meta.url),stdio:'inherit'});process.exit(result.status??1);
