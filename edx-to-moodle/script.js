"use strict";
// XML_to_Gift / EDX to Moodle GIFT v5.2
function giftEscape(s){return String(s).replace(/\\/g,"\\\\").replace(/([~=#{}:])/g,"\\$1");}
const choiceRE=/^(\(\s*([xхXХ]?)\s*\)|\[\s*([xхXХ]?)\s*\])\s*(.+)$/;
const numericalRE=/^#\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?::(?:\d+(?:\.\d*)?|\.\d+))?)\s*$/;
const pairRE=/\[\[([^\]\n]+)\]\]/;
const answerRE=/^(or=|=)\s*(.*)$/i;
function keyOf(c){const s=c.toLowerCase();return ({'а':'a','в':'b','с':'c'})[s]||s;}
function isAnswer(s){s=s.trim();return choiceRE.test(s)||numericalRE.test(s)||answerRE.test(s)||pairRE.test(s);}
function splitQuestions(text){
 const chunks=[];let current=[],answered=false;
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
  if(/^\s*\d+[.)]/.test(line)&&answered){chunks.push(current.join('\n').trim());current=[];answered=false;}
  if(line.trim()||current.length)current.push(line);
  if(isAnswer(line))answered=true;
 }
 if(current.some(s=>s.trim()))chunks.push(current.join('\n').trim());
 return chunks;
}
function parseMatching(lines,title){
 const pairs=[];let label='';
 for(const line of lines.slice(1)){
  const m=line.match(pairRE);
  if(!m){label=[label,line].filter(Boolean).join(' ').trim();continue;}
  label=[label,line.slice(0,m.index)].filter(Boolean).join(' ').trim();
  const options=m[1].split(',').map(s=>s.trim()).filter(Boolean);
  const right=options.filter(s=>/^\(.*\)$/.test(s));
  if(!label||right.length!==1)throw Error(`${title}: каждая пара соответствия должна иметь формулировку и один ответ в скобках.`);
  pairs.push(`=${giftEscape(label)} -> ${giftEscape(right[0].slice(1,-1).trim())}`);
  label=line.slice(m.index+m[0].length).trim();
 }
 if(label||pairs.length<2)throw Error(`${title}: неполное соответствие или менее двух пар.`);
 return {type:'matching',gift:`::${title}::${giftEscape(lines[0])} {\n${pairs.join('\n')}\n}\n\n`};
}
function parseMultiBlank(lines,title){
 // Backward parsing isolates answer groups, including optional 'or=' variants.
 const groups=[];let pos=lines.length;
 while(pos>0){
  let j=pos;const answers=[];
  while(j>0&&answerRE.test(lines[j-1])){const m=lines[j-1].match(answerRE);if(!m[2].trim())throw Error(`${title}: пустой ответ.`);answers.unshift({alt:m[1].toLowerCase()==='or=',text:m[2].trim()});j--;}
  if(!answers.length)break;
  const m=j>0?lines[j-1].match(/^([a-zа-я])(?:[.)])?\s*$/i):null;
  if(!m)break;
  if(answers[0].alt)throw Error(`${title}: после метки ${m[1]} сначала требуется =ответ.`);
  groups.unshift({key:keyOf(m[1]),answers});pos=j-1;
 }
 if(groups.length<2){
  const labelled=lines.filter((s,i)=>/^[a-zа-я](?:[.)])?$/i.test(s)&&answerRE.test(lines[i+1]||''));
  if(labelled.length>=2)throw Error(`${title}: не удалось разобрать все метки ответов.`);
  return null;
 }
 if(new Set(groups.map(g=>g.key)).size!==groups.length)throw Error(`${title}: повторяются метки ответов.`);
 let stem=lines.slice(0,pos).join('\n');
 const replacements=[];
 for(const [i,g] of groups.entries()){
  const aliases=g.key==='a'?'[aа]':g.key==='b'?'[bв]':g.key==='c'?'[cс]':g.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Style 1: a.____ / a) ____ ; style 2: ____А____ / ____B____ (any case).
  const dotted=new RegExp(`(^|[^\\p{L}\\p{N}])(${aliases}[.)]\\s*)_{2,}`,'giu');
  const embedded=new RegExp(`_{2,}\\s*${aliases}\\s*_{2,}`,'giu');
  const matches=[...stem.matchAll(dotted)].map(m=>({at:m.index,len:m[0].length,pre:m[1]+m[2]}))
    .concat([...stem.matchAll(embedded)].map(m=>({at:m.index,len:m[0].length,pre:''})));
  if(matches.length!==1)throw Error(`${title}: для пропуска ${g.key} найдено ${matches.length} совпадений (ожидается одно).`);
  const m=matches[0], token=`ZZCLOZEFIELD${i}ZZ`;
  stem=stem.slice(0,m.at)+m.pre+token+stem.slice(m.at+m.len);
  const unique=[...new Set(g.answers.map(v=>v.text))];
  const field=`{1:SHORTANSWER:${unique.map(x=>'='+giftEscape(x)).join('~')}}`;
  replacements.push({token,field});
 }
 const withoutTokens=replacements.reduce((s,r)=>s.replace(r.token,''),stem);
 if(/_{3,}/.test(withoutTokens))throw Error(`${title}: остались пропуски без ответов.`);
 let result=giftEscape(stem);
 for(const {token,field} of replacements)result=result.replace(token,field);
 return {type:'cloze',title,gift:`::${title}::${result}\n`,fields:groups.length};
}
function parseOne(block,idx){
 const raw=block.split('\n').map(s=>s.trim()).filter(Boolean);
 if(!raw.length)return null;
 const title=`Вопрос ${idx+1}`;
 const lines=[raw[0].replace(/^\d+[.)]\s*/,''),...raw.slice(1)];
 const cloze=parseMultiBlank(lines,title);if(cloze)return cloze;
 if(lines.some(s=>pairRE.test(s)))return parseMatching(lines,title);
 const at=lines.findIndex((s,i)=>i>0&&isAnswer(s));
 if(at<0)throw Error(`${title}: ответы не обнаружены.`);
 const question=giftEscape(lines.slice(0,at).join('\n'));
 const answers=lines.slice(at), marked=answers.map(s=>s.match(choiceRE));
 if(marked.every(Boolean)){
  const types=marked.map(m=>m[1][0]);if(new Set(types).size!==1)throw Error(`${title}: смешаны () и [].`);
  const good=marked.map(m=>Boolean(m[2]||m[3]));const count=good.filter(Boolean).length;
  if(!count||(types[0]==='('&&count!==1))throw Error(`${title}: неверное количество правильных ответов.`);
  let body;
  if(types[0]==='(')body=marked.map((m,i)=>(good[i]?'=':'~')+giftEscape(m[4].trim())).join('\n');
  else {const base=Math.floor(10000000/count),rem=10000000%count;let n=0;
   body=marked.map((m,i)=>{const units=good[i]?base+(n++<rem?1:0):-10000000;const pct=(units/100000).toFixed(5).replace(/\.?0+$/,'');return `~%${pct}%${giftEscape(m[4].trim())}`;}).join('\n');}
  return {type:'choice',gift:`::${title}::${question} {\n${body}\n}\n\n`};
 }
 if(answers.every(s=>answerRE.test(s)))return {type:'short',gift:`::${title}::${question} {\n${answers.map(s=>'='+giftEscape(s.match(answerRE)[2].trim())).join('\n')}\n}\n\n`};
 if(answers.length===1&&numericalRE.test(answers[0]))return {type:'numeric',gift:`::${title}::${question} {#${answers[0].match(numericalRE)[1]}}\n\n`};
 throw Error(`${title}: смешанный либо неподдерживаемый формат ответов.`);
}
function convertTextToGift(text){
 const blocks=splitQuestions(text);if(!blocks.length)throw Error('Вставьте исходные вопросы.');
 const parsed=blocks.map(parseOne);
 return {gift:parsed.filter(x=>x.type!=='cloze').map(x=>x.gift).join('').trim(),clozeFiles:parsed.filter(x=>x.type==='cloze').map(x=>({name:x.title,gift:x.gift,fields:x.fields})),counts:parsed.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{})};
}
function validateCloze(text,count){
 const fields=[...text.matchAll(/\{1:SHORTANSWER:([^{}]+)\}/g)];const errors=[];
 if(fields.length!==count)errors.push(`Ожидалось ${count} полей, найдено ${fields.length}.`);
 for(const [i,m] of fields.entries())if(!m[1].startsWith('=')||m[1].split(/(?<!\\)~(?==)/).some(s=>!s.replace(/^=/,'').trim()))errors.push(`Поле ${i+1}: пустой или неверный ответ.`);
 return errors;
}
function validateGift(text,source=''){
 const errors=[],warnings=[];
 if(!text.trim())return {errors:['Нет обычных GIFT-вопросов.'],warnings,count:0};
 if(source.trim())try{const expected=convertTextToGift(source);if(expected.gift.trim()!==text.trim())warnings.push('Результат изменён вручную. Проверьте правки.');}catch(e){errors.push('Ошибка исходных вопросов: '+e.message);}
 const blocks=text.trim().split(/\n\s*\n(?=::)/);
 for(const [i,b] of blocks.entries()){
  const name=`Вопрос ${i+1}`;
  if(!/^::[^\n]+::/.test(b)){errors.push(`${name}: отсутствует название.`);continue;}
  const start=b.indexOf('{'),end=b.lastIndexOf('}');if(start<0||end<=start){errors.push(`${name}: нет блока ответов.`);continue;}
  const body=b.slice(start+1,end).trim(),rows=body.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!rows.length){errors.push(`${name}: нет ответов.`);continue;}
  if(rows.every(s=>/^=.+\s->\s.+$/.test(s))){if(rows.length<2)errors.push(`${name}: нужно хотя бы две пары.`);continue;}
  const pct=rows.map(x=>x.match(/^~%([+-]?\d+(?:\.\d+)?)%/));
  if(pct.some(Boolean)){
   if(pct.some(x=>!x))errors.push(`${name}: смешаны веса и обычные ответы.`);
   const sum=pct.filter(Boolean).map(x=>Number(x[1])).filter(n=>n>0).reduce((a,b)=>a+b,0);
   if(Math.abs(sum-100)>0.000011)errors.push(`${name}: сумма положительных весов ${sum.toFixed(5)}%, требуется 100%.`);
   if(pct.some(x=>x&&Number(x[1])<0))warnings.push(`${name}: есть штрафы за неправильные ответы.`);
  }else if(!/^#/.test(body)&&!rows.some(x=>x.startsWith('=')))errors.push(`${name}: нет правильного ответа.`);
 }
 return {errors,warnings,count:blocks.length};
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);let clozeFiles=[];
 const version=document.createElement('span');version.textContent='Версия 5.2 · автоматическое распознавание пропусков';version.style.cssText='display:block;margin:0 20px 8px;font-size:13px;color:#44627f';document.querySelector('h1')?.insertAdjacentElement('afterend',version);
 const buttons=document.querySelector('.buttons');const verify=document.createElement('button');verify.type='button';verify.textContent='Проверить GIFT';buttons.insertBefore(verify,$('copyBtn'));
 const report=document.createElement('section');report.style.cssText='margin:0 20px 20px;padding:16px;background:white;border:1px solid #ddd;border-radius:14px;white-space:pre-wrap;display:none';buttons.insertAdjacentElement('afterend',report);
 const downloads=document.createElement('section');downloads.style.cssText='margin:0 20px 20px;padding:16px;background:white;border:1px solid #ddd;border-radius:14px;display:none';report.insertAdjacentElement('afterend',downloads);
 function save(content,name){const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.gift';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function render(){downloads.replaceChildren();downloads.style.display=clozeFiles.length?'block':'none';if(!clozeFiles.length)return;const p=document.createElement('p');p.textContent=`Cloze: ${clozeFiles.length}. Каждый вопрос скачивается отдельно и импортируется как «Вложенные ответы (Cloze)».`;downloads.append(p);
 clozeFiles.forEach((file,i)=>{const btn=document.createElement('button');btn.type='button';btn.style.cssText='width:auto;margin:8px;padding:12px';btn.textContent=`Скачать Cloze — ${file.name} (${file.fields} поля)`;btn.onclick=()=>{const errors=validateCloze(file.gift,file.fields);if(errors.length)return alert(errors.join('\n'));save(file.gift,`cloze_question_${i+1}`);};downloads.append(btn);});}
 function check(){const r=validateGift($('giftOutput').value,$('textInput').value);report.style.display='block';report.textContent=`Проверено обычных вопросов: ${r.count}\n`+(r.errors.length?'❌ '+r.errors.join('\n'):'✅ Критических ошибок не найдено.')+(r.warnings.length?'\n⚠️ '+r.warnings.join('\n'):'')+'\nТестовый импорт в Moodle всё равно необходим.';return r;}
 $('convertBtn').onclick=()=>{try{const r=convertTextToGift($('textInput').value);clozeFiles=r.clozeFiles;$('giftOutput').value=r.gift;render();$('customAlertOverlay').style.display=clozeFiles.length?'flex':'none';if(r.gift)check();else{report.style.display='block';report.textContent=`Обычных вопросов нет; Cloze-файлов: ${clozeFiles.length}.`}}catch(e){clozeFiles=[];render();$('giftOutput').value='';report.style.display='none';alert('Ошибка конвертации: '+e.message);}};
 verify.onclick=check;
 $('copyBtn').onclick=()=>{const r=check();if(r.errors.length)return alert('Скачивание заблокировано: '+r.errors.join('\n'));let name=prompt('Имя файла без расширения','questions');if(name===null)return;name=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim()||'questions';save($('giftOutput').value,name);};
 $('closeAlertBtn').onclick=()=>$('customAlertOverlay').style.display='none';
 $('clearAll').onclick=()=>{clozeFiles=[];render();$('textInput').value='';$('giftOutput').value='';report.style.display='none';$('customAlertOverlay').style.display='none';};
 $('textInput').addEventListener('input',()=>{clozeFiles=[];render();});
}
if(typeof module!=='undefined')module.exports={convertTextToGift,parseOne,splitQuestions,validateCloze,validateGift};
splitQuestions = function splitQuestionsWithNumberedMatching(text) {
  const chunks = [];
  let current = [];
  let answered = false;
  let innerNumber = 0;
  let matchingMode = false;

  function flush() {
    if (current.some(line => line.trim())) chunks.push(current.join("\n").trim());
    current = [];
    answered = false;
    innerNumber = 0;
    matchingMode = false;
  }

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(/^\s*(\d+)[.)]\s*(\S.*)?$/);
    if (m && current.length) {
      const n = Number(m[1]);
      const isInnerNumber = matchingMode && n === innerNumber + 1;
      if (answered && !isInnerNumber) flush();
      // Внутри «соотнесите» метки 1., 2., 3., ... относятся к парам.
      // Первую метку 1. запоминаем ещё до первого [[...]].
      if (isInnerNumber || (!answered && n === 1 && /соотнесите/i.test(current.join(" ")))) {
        innerNumber = n;
      }
    }
    if (line.trim() || current.length) current.push(line);
    if (/\[\[[^\]\n]+\]\]/.test(line)) matchingMode = true;
    if (isAnswerLine(line)) answered = true;
  }
  flush();
  return chunks;
};
