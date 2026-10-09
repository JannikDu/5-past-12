import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import type { ClimateEventFeed } from '../src/domain/climate-event-feed.ts';
const original=new URL('../src/components/ClimateConnectionProgress.tsx',import.meta.url);
const source=(await readFile(original,'utf8')).replace(/from '([^']+)'/g,(match,specifier:string)=>specifier.startsWith('.')?`from '${new URL(specifier,original).href}'`:match);
const directory=new URL('../.devswarm-temp/assessment-tests/',import.meta.url);await mkdir(directory,{recursive:true});
const compiled=new URL(`progress-${process.pid}.mjs`,directory);await writeFile(compiled,ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {default:Progress}=await import(compiled.href) as typeof import('../src/components/ClimateConnectionProgress.tsx');
test('connection feed renders honest processing totals and ongoing/complete history with no invented attribution',()=>{
  const feed:ClimateEventFeed={events:[],indicators:[],updatedAt:null,historyEnd:null,counts:{total:12,pending:5,failed:3,insufficient:4,connections:0}};
  const html=renderToStaticMarkup(createElement(Progress,{feed}));assert.match(html,/5 awaiting assessment/);assert.match(html,/3 assessments failed/);assert.match(html,/4 with insufficient evidence/);assert.match(html,/not probabilities/);assert.match(html,/not started/);
  assert.match(renderToStaticMarkup(createElement(Progress,{feed:{...feed,historyEnd:'2000-01-01'}})),/discovery is complete/);
  assert.match(renderToStaticMarkup(createElement(Progress,{feed:{...feed,historyEnd:new Date().toISOString().slice(0,10)}})),/discovery is continuing/);
});
