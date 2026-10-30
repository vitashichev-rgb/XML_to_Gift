"use strict";
// EDX -> Moodle GIFT v5.4: numbered matching and multi-blank Cloze.
const choiceRE = /^(\(\s*([xхXХ]?)\s*\)|\[\s*([xхXХ]?)\s*\])\s*(.+)$/;
const numericRE = /^#\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?::(?:\d+(?:\.\d*)?|\.\d+))?)\s*$/;
const pairRE = /\[\[([^\]\n]+)\]\]/;
const answerRE = /^(or=|=)\s*(.*)$/i;
const markerRE = /^\s*(\d+)[.)]\s*(\S.*)?$/;
function giftEscape(value) { return String(value).replace(/\\/g, "\\\\").replace(/([~=#{}:])/g, "\\$1"); }
function isAnswer(line) { const s=line.trim(); return choiceRE.test(s)||numericRE.test(s)||answerRE.test(s)||pairRE.test(s); }
function keyOf(s) { return ({а:"a",в:"b",с:"c"})[s.toLowerCase()] || s.toLowerCase(); }
function splitQuestions(text) {
  const chunks=[]; let current=[], hasAnswer=false, matching=false, nextInner=1;
  function flush(){ if(current.some(x=>x.trim())) chunks.push(current.join("\n").trim()); current=[];hasAnswer=false;matching=false;nextInner=1; }
  for(const line of text.replace(/\r\n?/g,"\n").split("\n")) {
    const m=line.match(markerRE);
    if(m && current.length) {
      const number=Number(m[1]);
      const inMatching=/соотнесите/i.test(current[0]||"") || matching;
      const isInner=inMatching && number===nextInner && !/соотнесите/i.test(m[2]||"");
      if(hasAnswer && !isInner) flush();
      else if(isInner) nextInner++;
    }
    if(line.trim() || current.length) current.push(line);
    if(pairRE.test(line)) matching=true;
    if(isAnswer(line)) hasAnswer=true;
  }
  flush(); return chunks;
}
function parseMatching(lines,title) {
  const pairs=[]; let label="";
  for(const line of lines.slice(1)) {
    const match=line.match(pairRE);
    if(!match){label=[label,line].filter(Boolean).join(" ").trim();continue;}
    label=[label,line.slice(0,match.index)].filter(Boolean).join(" ").trim();
    const options=match[1].split(",").map(x=>x.trim()).filter(Boolean);
    const correct=options.filter(x=>/^\([\s\S]+\)$/.test(x));
    if(!label || correct.length!==1) throw Error(`${title}: неправильная пара соответствия «${label}».`);
    const value=correct[0].slice(1,-1).trim();
    if(!value) throw Error(`${title}: пустой ответ соответствия.`);
    pairs.push(`=${giftEscape(label)} -> ${giftEscape(value)}`);
    label=line.slice(match.index+match[0].length).trim();
  }
  if(label || pairs.length<2) throw Error(`${title}: осталось утверждение без ответа или найдено менее двух пар.`);
  return {type:"matching",gift:`::${title}::${giftEscape(lines[0])} {\n${pairs.join("\n")}\n}\n\n`,pairs:pairs.length};
}
function parseMultiBlank(lines,title) {
  const groups=[];let pos=lines.length;
  while(pos>0) {
    let j=pos;const answers=[];
    while(j>0 && answerRE.test(lines[j-1])) {
      const m=lines[j-1].match(answerRE);
      if(!m[2].trim()) throw Error(`${title}: пустой ответ.`);
      answers.unshift({alternative:m[1].toLowerCase()==="or=",text:m[2].trim()});j--;
    }
    if(!answers.length) break;
    const label=j>0?lines[j-1].match(/^([a-zа-я])(?:[.)])?\s*$/i):null;
    if(!label) break;
    if(answers[0].alternative) throw Error(`${title}: для поля ${label[1]} сначала требуется =ответ.`);
    groups.unshift({key:keyOf(label[1]),answers});pos=j-1;
  }
  if(groups.length<2) {
    const labels=lines.filter((line,i)=>/^[a-zа-я](?:[.)])?$/i.test(line)&&answerRE.test(lines[i+1]||""));
    if(labels.length>=2)throw Error(`${title}: не удалось разобрать метки пропусков.`);
    return null;
  }
  if(new Set(groups.map(x=>x.key)).size!==groups.length)throw Error(`${title}: повторяются метки пропусков.`);
  let stem=lines.slice(0,pos).join("\n");const fields=[];
  for(const [i,group] of groups.entries()) {
    const letter=group.key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const aliases=letter==="a"?"[aа]":letter==="b"?"[bв]":letter==="c"?"[cс]":letter;
    const dotted=new RegExp(`(^|[^\\p{L}\\p{N}])(${aliases}[.)]\\s*)_{2,}`,"giu");
    const embedded=new RegExp(`_{2,}\\s*${aliases}\\s*_{2,}`,"giu");
    const found=[...stem.matchAll(dotted)].map(m=>({at:m.index,len:m[0].length,prefix:m[1]+m[2]}))
      .concat([...stem.matchAll(embedded)].map(m=>({at:m.index,len:m[0].length,prefix:""})));
    if(found.length!==1)throw Error(`${title}: для пропуска ${group.key} найдено ${found.length} совпадений (нужно одно).`);
    const m=found[0],token=`ZZGIFTPLACEHOLDER${i}ZZ`;
    stem=stem.slice(0,m.at)+m.prefix+token+stem.slice(m.at+m.len);
    const unique=[...new Set(group.answers.map(x=>x.text))];
    fields.push({token,value:`{1:SHORTANSWER:${unique.map(x=>"="+giftEscape(x)).join("~")}}`});
  }
  if(/_{3,}/.test(fields.reduce((s,f)=>s.replace(f.token,""),stem)))throw Error(`${title}: остались пропуски без ответов.`);
  let out=giftEscape(stem); for(const f of fields)out=out.replace(f.token,f.value);
  return {type:"cloze",gift:`::${title}::${out}\n`,fields:groups.length,title};
}
function parseOne(block,index) {
  const raw=block.split("\n").map(s=>s.trim()).filter(Boolean);
  if(!raw.length)throw Error("Пустой вопрос.");
  const title=`Вопрос ${index+1}`;
  const lines=[raw[0].replace(/^\d+[.)]\s*/,""),...raw.slice(1)];
  const cloze=parseMultiBlank(lines,title);if(cloze)return cloze;
  if(lines.some(s=>pairRE.test(s)))return parseMatching(lines,title);
  const at=lines.findIndex((s,i)=>i>0&&isAnswer(s));
  if(at<0)throw Error(`${title}: ответы не найдены.`);
  const question=giftEscape(lines.slice(0,at).join("\n")), answers=lines.slice(at);
  const marked=answers.map(x=>x.match(choiceRE));
  if(marked.every(Boolean)) {
    const kind=marked[0][1][0];
    if(marked.some(m=>m[1][0]!==kind))throw Error(`${title}: смешаны () и [].`);
    const good=marked.map(m=>!!(m[2]||m[3])),count=good.filter(Boolean).length;
    if(!count||(kind==="("&&count!==1))throw Error(`${title}: неверное число правильных ответов.`);
    let body;
    if(kind==="(")body=marked.map((m,i)=>(good[i]?"=":"~")+giftEscape(m[4].trim())).join("\n");
    else {
      const base=Math.floor(10000000/count),rem=10000000%count;let n=0;
      body=marked.map((m,i)=>{const units=good[i]?base+(n++<rem?1:0):-10000000;
        return `~%${(units/100000).toFixed(5).replace(/\.?0+$/,"")}%${giftEscape(m[4].trim())}`;}).join("\n");
    }
    return {type:"choice",gift:`::${title}::${question} {\n${body}\n}\n\n`};
  }
  if(answers.every(x=>answerRE.test(x)))return {type:"short",gift:`::${title}::${question} {\n${answers.map(x=>"="+giftEscape(x.match(answerRE)[2].trim())).join("\n")}\n}\n\n`};
  if(answers.length===1&&numericRE.test(answers[0]))return {type:"numeric",gift:`::${title}::${question} {#${answers[0].match(numericRE)[1]}}\n\n`};
  throw Error(`${title}: смешанный или неподдерживаемый формат ответов.`);
}
function convertTextToGift(text) {
  const blocks=splitQuestions(text);if(!blocks.length)throw Error("Вставьте вопросы.");
  const parsed=blocks.map(parseOne);
  return {gift:parsed.filter(x=>x.type!=="cloze").map(x=>x.gift).join("").trim(),
    clozeFiles:parsed.filter(x=>x.type==="cloze").map(x=>({name:x.title,gift:x.gift,fields:x.fields})),
    counts:parsed.reduce((acc,x)=>(acc[x.type]=(acc[x.type]||0)+1,acc),{}),questions:parsed};
}
function validateCloze(text,expected) {
  const fields=[...text.matchAll(/\{1:SHORTANSWER:([^{}]+)\}/g)],errors=[];
  if(fields.length!==expected)errors.push(`Ожидалось ${expected} полей, найдено ${fields.length}.`);
  for(const [i,m] of fields.entries())if(!m[1].startsWith("=")||m[1].split(/(?<!\\)~(?==)/).some(s=>!s.replace(/^=/,"").trim()))errors.push(`Поле ${i+1}: отсутствует ответ.`);
  return errors;
}
function validateGift(text,source="") {
  const errors=[],warnings=[];
  if(!text.trim())return {errors:["Нет обычных GIFT-вопросов."],warnings,count:0};
  if(source.trim())try{if(convertTextToGift(source).gift.trim()!==text.trim())warnings.push("Результат отредактирован вручную.");}catch(e){errors.push("Исходный текст: "+e.message);}
  const blocks=text.trim().split(/\n\s*\n(?=::)/);
  for(const [i,b] of blocks.entries()) {
    const name=`Вопрос ${i+1}`,start=b.indexOf("{"),end=b.lastIndexOf("}");
    if(!/^::[^\n]+::/.test(b)||start<0||end<=start){errors.push(`${name}: неверная структура GIFT.`);continue;}
    const rows=b.slice(start+1,end).trim().split("\n").filter(Boolean);
    if(rows.every(r=>/^=.+\s->\s.+$/.test(r))){if(rows.length<2)errors.push(`${name}: нужно минимум две пары.`);continue;}
    const pct=rows.map(x=>x.match(/^~%([+-]?\d+(?:\.\d+)?)%/));
    if(pct.some(Boolean)){
      if(pct.some(x=>!x))errors.push(`${name}: смешаны взвешенные и обычные варианты.`);
      const sum=pct.filter(Boolean).map(x=>+x[1]).filter(x=>x>0).reduce((a,b)=>a+b,0);
      if(Math.abs(sum-100)>0.000011)errors.push(`${name}: сумма положительных весов должна быть 100%.`);
      if(pct.some(x=>x&&+x[1]<0))warnings.push(`${name}: есть штрафы за неверные ответы.`);
    }else if(!rows.some(x=>x.startsWith("=")||x.startsWith("#")))errors.push(`${name}: не найден правильный ответ.`);
  }
  return {errors,warnings,count:blocks.length};
}
if(typeof document!=="undefined"){
  const $=id=>document.getElementById(id);let clozeFiles=[];
  const version=document.createElement("span");version.textContent="Версия 5.4 · исправлено соответствие с нумерацией";
  version.style.cssText="display:block;margin:0 20px 8px;font-size:13px;color:#44627f";
  document.querySelector("h1")?.insertAdjacentElement("afterend",version);
  const bar=document.querySelector(".buttons"),checkButton=document.createElement("button");
  checkButton.type="button";checkButton.textContent="Проверить GIFT";bar.insertBefore(checkButton,$("copyBtn"));
  const report=document.createElement("section");report.style.cssText="margin:0 20px 20px;padding:16px;background:white;border:1px solid #ddd;border-radius:14px;white-space:pre-wrap;display:none";
  bar.insertAdjacentElement("afterend",report);
  const downloads=document.createElement("section");downloads.style.cssText="margin:0 20px 20px;padding:16px;background:white;border:1px solid #ddd;border-radius:14px;display:none";
  report.insertAdjacentElement("afterend",downloads);
  function save(text,name){const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name+".gift";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function render(){downloads.replaceChildren();downloads.style.display=clozeFiles.length?"block":"none";if(!clozeFiles.length)return;
    const p=document.createElement("p");p.textContent=`Cloze: ${clozeFiles.length}. Каждый вопрос сохраняется отдельно и импортируется как «Вложенные ответы (Cloze)».`;downloads.append(p);
    clozeFiles.forEach((f,i)=>{const b=document.createElement("button");b.type="button";b.style.cssText="width:auto;margin:8px;padding:12px";b.textContent=`Скачать Cloze — ${f.name} (${f.fields} поля)`;b.onclick=()=>{const e=validateCloze(f.gift,f.fields);if(e.length)return alert(e.join("\n"));save(f.gift,`cloze_question_${i+1}`);};downloads.append(b);});}
  function check(){const r=validateGift($("giftOutput").value,$("textInput").value);report.style.display="block";
    report.textContent=`Проверено обычных вопросов: ${r.count}\n`+(r.errors.length?"❌ "+r.errors.join("\n"):"✅ Критических ошибок не найдено.")+(r.warnings.length?"\n⚠️ "+r.warnings.join("\n"):"")+"\nПроверьте импорт в Moodle.";return r;}
  $("convertBtn").onclick=()=>{try{const r=convertTextToGift($("textInput").value);clozeFiles=r.clozeFiles;$("giftOutput").value=r.gift;render();$("customAlertOverlay").style.display=clozeFiles.length?"flex":"none";
    if(r.gift)check();else{report.style.display="block";report.textContent=`Обычных вопросов нет. Cloze-файлов: ${clozeFiles.length}.`;}}
    catch(e){clozeFiles=[];render();$("giftOutput").value="";report.style.display="none";alert("Ошибка конвертации: "+e.message);}};
  checkButton.onclick=check;
  $("copyBtn").onclick=()=>{const r=check();if(r.errors.length)return alert("Исправьте ошибки: "+r.errors.join("\n"));let name=prompt("Имя файла без расширения","questions");if(name===null)return;name=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,"").trim()||"questions";save($("giftOutput").value,name);};
  $("closeAlertBtn").onclick=()=>$("customAlertOverlay").style.display="none";
  $("clearAll").onclick=()=>{clozeFiles=[];render();$("textInput").value="";$("giftOutput").value="";report.style.display="none";$("customAlertOverlay").style.display="none";};
  $("textInput").addEventListener("input",()=>{clozeFiles=[];render();});
}
if(typeof module!=="undefined")module.exports={convertTextToGift,splitQuestions,parseOne,validateGift,validateCloze};
