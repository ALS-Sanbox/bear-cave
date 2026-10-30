// Use the parsers already shipped with the project; no additional formatter dependency.
import ts from 'typescript';
import {parse as parseSfc} from '@vue/compiler-sfc';
import {parse as baseParse} from '@vue/compiler-dom';
import postcss from 'postcss';
import {readdir,readFile,writeFile as saveFile} from 'node:fs/promises';
import path from 'node:path';
const check=process.argv.includes('--check'),targets=process.argv.slice(2).filter(a=>a!=='--check').map(f=>path.resolve(f));
async function writeFile(file,text){if(check){if(await readFile(file,'utf8')!==text){console.error('Formatting differs:',file);process.exitCode=1;}}else await saveFile(file,text);}
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
function script(text,file){const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.cjs')?ts.ScriptKind.JS:ts.ScriptKind.TS);function visit(n){if(ts.isBlock(n)||ts.isObjectLiteralExpression(n)&&n.properties.length>2)n.multiLine=true;ts.forEachChild(n,visit);}visit(ast);return printer.printFile(ast);}
function template(text){
  const ast=baseParse(text);const lines=[];
  function visit(node,depth){const indent='  '.repeat(depth),source=node.loc.source.trim();if(!source)return;
    if(node.type!==1||node.isSelfClosing||!node.children.length||node.children.every(n=>[2,5].includes(n.type))){lines.push(indent+source);return;}
    let quote='',end=0;for(;end<source.length;end++){const c=source[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    lines.push(indent+source.slice(0,end+1));for(const child of node.children)visit(child,depth+1);lines.push(indent+`</${node.tag}>`);
  }
  ast.children.forEach(n=>visit(n,0));return lines.join('\n')+'\n';
}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='assets')await walk(file);continue;}if(targets.length&&!targets.includes(path.resolve(file)))continue;const text=await readFile(file,'utf8').catch(()=>undefined);if(text===undefined)continue;
  if(/\.(ts|cjs)$/.test(file))await writeFile(file,script(text,file));
  else if(file.endsWith('.vue')){const {descriptor}=parseSfc(text);let formatted='';if(descriptor.scriptSetup)formatted+=`<script setup lang="ts">\n${script(descriptor.scriptSetup.content,file+'.ts')}</script>\n\n`;if(descriptor.template)formatted+=`<template>\n${template(descriptor.template.content)}</template>\n`;await writeFile(file,formatted);}
  else if(file.endsWith('.css')){const root=postcss.parse(text);root.walk(node=>{const depth=(()=>{let n=0,p=node.parent;while(p&&p.type!=='root'){n++;p=p.parent;}return n;})();node.raws.before=(node.type==='decl'?'\n':'\n\n')+'  '.repeat(depth);node.raws.between=node.type==='decl'?': ':' ';if(node.nodes)node.raws.after='\n'+'  '.repeat(depth);});await writeFile(file,root.toString().trim()+'\n');}
}}
await walk('src');
