import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const browser=process.env.TEST_CHROMIUM || process.env.CHROMIUM_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const env={...process.env,...(browser?{TEST_CHROMIUM:browser,CHROMIUM_PATH:browser}:{})};
const failures=[];
function run(name,args) {
  console.log(`\nTEST ${name}`);
  const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});
  if(result.status!==0) {failures.push(name);if(result.error) console.error(result.error.message);}
}
run('build',['scripts/build.mjs']);
if(failures.length) process.exit(1);
run('unit',['--test',...readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`tests/${name}`)]);
const cases=[
  'workspace-browser','text-layout-browser','scan-coverage-browser','evidence-editor',
  'dynamic-browser','shelf-browser','shelf-processing',
  'control-boundaries','browser','labels-browser','placeholder-browser','hints-capture','hints-image','counter-capture','counter-image','choices-browser',
  'multi-text-browser','structured-browser','scan-target','drag-batch','window-drop',
  'permission-flow','quick-entry','region-browser','generic-workflow','mixed-source',
  'extension','screenshot-layout','structured-image','multi-image','ocr-local',
  'capture-persistence','workflow','state-capture','state-region-workflow',
];
for(const name of cases) run(name,[`tests/${name}.mjs`]);
if(failures.length) {console.error(`\nFAILED: ${failures.join(', ')}`);process.exitCode=1;}
else console.log(`\nPASS: build, unit tests, ${cases.length} browser/extension suites`);
